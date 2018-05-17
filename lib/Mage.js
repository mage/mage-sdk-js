var EventEmitter = require('events.js');
var inherits = require('inherits');
var EventManager = require('./EventManager');
var CommandCenter = require('./CommandCenter');
var MsgServer = require('./MsgServer');
var HttpRequest = require('./HttpRequest');


function MageNotConfiguredError() {
	return new Error('Please call mage.configure before calling any method');
}

function MageConfigureError(errMsg) {
	errMsg = errMsg || '';
	return new Error(
		'Failed to configure MAGE: ' + errMsg + '\n' +
		'Please ensure that:\n' +
		'1. You have a MAGE server running at the configured enpoint\n' +
		'2. You activated the config module on your MAGE server'
	);
}

function Mage() {
	EventEmitter.call(this);

	this.eventManager = new EventManager();
	this.msgServer = new MsgServer(this.eventManager);
	this.commandCenter = new CommandCenter(this.eventManager);
}

inherits(Mage, EventEmitter);

module.exports = Mage;

Mage.prototype.batchCommands = function (commands, cb) {
	if (cb && typeof cb !== 'function') {
		throw new TypeError('mage.batchCommands callback is not a function: ' + cb);
	}

	var promises = Promise.all(commands);

	if (cb) {
		promises.then(function (res) {
			cb(null, res);
		}).catch(function (err) {
			cb(err);
		});
	} else {
		return promises;
	}
};

// call config.get usercommand to get client config and init mage SDK with it
//
// the usercommand is called manually because CommandCenter needs the config to setup

Mage.prototype.configure = function (cb) {
	if (!this.endpoint) {
		throw new Error('Please call mage.setEndpoint before calling mage.configure');
	}

	var that = this;
	var hr = new HttpRequest({
		noCache: true,
		withCredentials: false
	});
	var url = this.endpoint + '/' + this.appName + '/config.get';
	var data = {
		baseUrl: this.endpoint,
		appName: this.appName
	};

	data = '[]\n' + JSON.stringify(data);

	hr.send('POST', url, {}, data, null, function (err, res) {
		if (err) {
			return cb(new MageConfigureError(err));
		}

		var resData = res[0];
		var errMsg = resData[0];
		if (errMsg) {
			return cb(new MageConfigureError(errMsg));
		}

		that.setup(resData[1], cb);
	});
};

Mage.prototype.setEndpoint = function (endpoint, appName) {
	if (!appName) {
		appName = 'game';
	}

	this.endpoint = endpoint;
	this.appName = appName;
};

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

Mage.prototype.setup = function (config, cb) {
	if (!config) {
		return cb(new Error('Mage requires a configuration to be instantiated.'));
	}

	this.config = config;

	this.appName = config.appName;
	this.appVersion = config.appVersion;

	// set up server connections

	this.clientHostBaseUrl = config.baseUrl || this.endpoint;

	var server = config.server || {};

	this.savvyBaseUrl = server.savvy ? server.savvy.url : ''; // TODO: what about server.savvy.cors?

	if (server.commandCenter) {
		this.commandCenter.setupCommandSystem(server.commandCenter);
		this.setupCommandsModules(server.commandCenter.commands, function (err) {
			if (err) {
				return cb(err);
			}
		});
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

	return cb(null);
};

Mage.prototype.isDevelopmentMode = function () {
	return this.config.developmentMode;
};


// The MAGE module system

var modules = {};

Mage.prototype.isConfigured = function () {
	return !!this.config;
};

// Call setup function from the given module

Mage.prototype.setupModule = function (name, mod) {
	mod = mod || {};
	var that = this;

	return new Promise(function (resolve, reject) {
		if (!that.isConfigured()) {
			return reject(new MageNotConfiguredError());
		}

		if (!modules.hasOwnProperty(name)) {
			return reject(new Error('Cannot configure module ' + name + '. This module has not been loaded'));
		}

		modules[name] = that[name] = Object.assign(mod, that[name]);

		if (!mod.hasOwnProperty('setup')) {
			that.emit('setup.' + name, mod);
			return resolve(mod);
		}

		mod.setup(function (error) {
			if (error) {
				return reject(error);
			}

			that.emit('setup.' + name, mod);
			return resolve(mod);
		});
	});
};

Mage.prototype.getModule = function (name) {
	return this.modules[name];
};

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
	body.push('\t\treturn commandCenter.sendCommand(' + JSON.stringify(modName + '.' + cmdName) + ', params, cb);');
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

// Load all commands from a module
//
// It will:
// 1) Add a module object in the Mage instance
// 2) Add a function for each command in the module object
//
// Ex: command list in module player would add mage.player.list

function initModule(mage, name, cb) {
	if (!mage.isConfigured()) {
		return cb(new MageNotConfiguredError());
	} else if (mage[name]) {
		return cb(new Error('Cannot register module "' + name + '". This is a reserved name.'));
	}

	var mod = {};
	modules[name] = mage[name] = mod;

	var commands = mage.config.server.commandCenter.commands[name];

	if (commands && commands.length > 0) {
		for (var j = 0; j < commands.length; j += 1) {
			var cmd = commands[j];

			mod[cmd.name] = createUserCommand(mage.commandCenter, name, cmd.name, cmd.params || []);
		}
	}

	mage.emit('created.' + name, mod);

	return cb(null);
}

// Load all commands from client config

Mage.prototype.setupCommandsModules = function (modules, cb) {
	if (!modules) {
		return;
	}

	var modulesNames = Object.keys(modules);
	for (var i = 0; i < modulesNames.length; i += 1) {
		var moduleName = modulesNames[i];
		if (this[moduleName]) {
			continue;
		}

		initModule(this, moduleName, cb);
	}
};
