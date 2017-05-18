var EventEmitter = require('events.js');
var inherits = require('inherits');
var EventManager = require('./EventManager');
var CommandCenter = require('./CommandCenter');
var MsgServer = require('./MsgServer');


function Mage(config) {
	EventEmitter.call(this);

	this.eventManager = new EventManager();
	this.msgServer = new MsgServer(this.eventManager);
	this.commandCenter = new CommandCenter(this.eventManager);

	this.configure(config);
}

inherits(Mage, EventEmitter);

module.exports = Mage;


Mage.prototype.getClientHostBaseUrl = function () {
	return this.clientHostBaseUrl;
};


Mage.prototype.getSavvyBaseUrl = function (protocol) {
	var baseUrl = this.savvyBaseUrl;
	if (!baseUrl) {
		baseUrl = '/savvy';
	}

	if (baseUrl[0] === '/') {
		// location.origin is perfect for this, but badly supported

		baseUrl = this.savvyBaseUrl = window.location.protocol + '//' + window.location.host + baseUrl;

		console.warn('No savvy base URL configured, defaulting to:', baseUrl, '(which may not work)');
	}

	if (protocol) {
		// drop any trailing colons and slashes

		protocol = protocol.replace(/:?\/*$/, '');

		return baseUrl.replace(/^.*:\/\//, protocol + '://');
	}

	return baseUrl;
};


// expose configuration set up
// mage.configure registers the configuration and emits 'configure'

Mage.prototype.configure = function (config) {
	if (!config) {
		throw new Error('Mage requires a configuration to be instantiated.');
	}

	this.config = config;

	this.appName = config.appName;
	this.appVersion = config.appVersion;

	// set up server connections

	this.clientHostBaseUrl = config.baseUrl || '';

	var server = config.server || {};

	this.savvyBaseUrl = server.savvy ? server.savvy.url : ''; // TODO: what about server.savvy.cors?

	if (server.commandCenter) {
		this.commandCenter.setupCommandSystem(server.commandCenter);
	}

	if (this.msgServer.setupMessageStream(server.msgStream)) {
		var that = this;

		this.once('created.session', function () {
			// Session module is created, set up the event listeners:

			// When a session key is available or changes, set the key and (re)start the message stream.
			that.eventManager.on('session.set', function (path, session) {
				that.msgServer.setSessionKey(session.key);
				that.msgServer.start();
			});

			// When a session key expires, stop the message stream.
			that.eventManager.on('session.unset', function () {
				that.msgServer.abort();
			});
		});
	}
};


Mage.prototype.isDevelopmentMode = function () {
	return this.config.developmentMode;
};


// The MAGE module system

var setupQueue = [];
var modules = {};

function setupModule(mage, modName, cb) {
	var mod = modules[modName];

	if (!mod) {
		return cb();
	}

	if (!mod.hasOwnProperty('setup')) {
		mage.emit('setup.' + modName, mod);
		return cb();
	}

	mod.setup(function (error) {
		if (error) {
			return cb(error);
		}

		mage.emit('setup.' + modName, mod);
		return cb();
	});
}


function setupModules(mage, modNames, cb) {
	var done = 0;
	var len = modNames.length;

	var lastError;

	function finalCb() {
		mage.emit('setupComplete');

		if (cb) {
			cb(lastError);
			cb = null;
		}
	}

	function stepCb(error) {
		lastError = error || lastError;
		done += 1;

		if (done === len) {
			finalCb();
		}
	}

	if (len === 0) {
		return finalCb();
	}

	for (var i = 0; i < len; i += 1) {
		setupModule(mage, modNames[i], stepCb);
	}
}


function createUserCommand(commandCenter, modName, cmdName, params) {
	// function name (camelCase)

	var fnName = modName + cmdName[0].toUpperCase() + cmdName.slice(1);

	// function arguments

	params = params.concat('cb');

	var args = params.join(', ');

	// expected use

	var expected = modName + '.' + cmdName + '(' + args + ')';

	// real use

	// eslint-disable-next-line no-unused-vars
	function serializeActualUse(args) {
		var result = [];

		for (var i = 0; i < args.length; i += 1) {
			var arg = args[i];

			if (typeof arg === 'function') {
				arg = 'Function';
			} else {
				arg = JSON.stringify(arg);
			}

			result.push(arg);
		}

		return modName + '.' + cmdName + '(' + result.join(', ') + ')';
	}

	// function body

	var body = [];

	body.push('fn = function ' + fnName + '(' + args + ') {');
	body.push('\tvar params = {');

	for (var i = 0; i < params.length; i += 1) {
		body.push('\t\t' + params[i] + ': ' + params[i] + (i < params.length - 1 ? ',' : ''));
	}

	body.push('\t};');
	body.push('');
	body.push('\ttry {');
	body.push('\t\tcommandCenter.sendCommand(' + JSON.stringify(modName + '.' + cmdName) + ', params, cb);');
	body.push('\t} catch (error) {');
	body.push('\t\tconsole.warn(' + JSON.stringify('Expected use: ' + expected) + ');');
	body.push('\t\tconsole.warn("Actual use: " + serializeActualUse(arguments));');
	body.push('\t\tthrow error;');
	body.push('\t};');
	body.push('};');

	body = body.join('\n');

	var fn;

	try {
		// eslint-disable-next-line no-eval
		eval(body);
	} catch (e) {
		console.error('Error generating usercommand:', modName + '.' + cmdName);
		throw e;
	}

	return fn;
}


Mage.prototype.canAddModule = function (name) {
	if (modules.hasOwnProperty(name)) {
		return false;
	}

	if (this[name]) {
		throw new Error('Cannot register module "' + name + '". This is a reserved name.');
	}

	return true;
};


Mage.prototype.addModule = function (name, mod) {
	if (!this.canAddModule(name)) {
		return;
	}

	modules[name] = this[name] = mod;

	var commands = this.config.server.commandCenter.commands[name];

	if (commands && commands.length > 0) {
		for (var j = 0; j < commands.length; j += 1) {
			var cmd = commands[j];

			mod[cmd.name] = createUserCommand(this.commandCenter, name, cmd.name, cmd.params || []);
		}
	}

	this.emit('created.' + name, mod);

	setupQueue.push(name);

	return this;
};


Mage.prototype.useModules = function () {
	var appRequire = arguments[0];

	if (typeof appRequire !== 'function') {
		throw new TypeError('useModules: the first argument must be require.');
	}

	for (var i = 1; i < arguments.length; i += 1) {
		var name = arguments[i];

		if (!this.canAddModule(name)) {
			continue;
		}

		// check if this module should exist
		// if not, we provide an empty object for user commands to be registered on

		var hasImplementation = false;

		var resolved = appRequire.resolve(name);
		if (resolved) {
			hasImplementation = !!window.require.resolve(resolved);
		}

		var mod = hasImplementation ? appRequire(name) : {};

		if (!hasImplementation) {
			console.warn('Module "' + name + '" has no implementation.');
		}

		this.addModule(name, mod);
	}

	return this;
};


Mage.prototype.setupModules = function (modNames, cb) {
	// remove all given module names from the current setupQueue

	var newSetupQueue = [];	// replacement array for setupQueue
	var toSetup = [];	// the modNames that we'll end up setting up

	for (var i = 0; i < setupQueue.length; i += 1) {
		var queuedModName = setupQueue[i];

		if (modNames.indexOf(queuedModName) === -1) {
			newSetupQueue.push(queuedModName);
		} else {
			toSetup.push(queuedModName);
		}
	}

	setupQueue = newSetupQueue;

	setupModules(this, toSetup, cb);
};

// mage.setup sets up all modules yet to be set up,
// after which it emits the event 'setup'

Mage.prototype.setup = function (cb) {
	this.setupModules(setupQueue, cb);
};
