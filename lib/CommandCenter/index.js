function CommandCenter(eventManager) {
	var HttpRequest = require('../HttpRequest');

	this.transports = {
		http: HttpRequest
	};

	this.cmdHooks = [];

	this.queryId = 0;
	this.commandSystemStarted = false;
	this.cmdMode = 'free';
	this.simulatedTransportError = null;
	this.simulatedCommandError = null;

	this.eventManager = eventManager;
}

module.exports = CommandCenter;


// transport

CommandCenter.prototype.createTransport = function (type, options) {
	// check transport availability

	var Transport = this.transports[type];
	if (!Transport) {
		throw new Error('No transport type "' + type + '" found.');
	}

	return new Transport(options);
};

// command center

CommandCenter.prototype.setCmdMode = function (mode) {
	if (mode !== 'free' && mode !== 'blocking') {
		throw new Error('Unrecognized command mode "' + mode + '", use "free" or "blocking".');
	}

	this.cmdMode = mode;
};


CommandCenter.prototype.registerCommandHook = function (name, fn) {
	// replace the old command hook if there is one

	for (var i = 0; i < this.cmdHooks.length; i += 1) {
		var cmdHook = this.cmdHooks[i];

		if (cmdHook.name === name) {
			cmdHook.fn = fn;
			return;
		}
	}

	// else append to the end

	this.cmdHooks.push({ name: name, fn: fn });
};


CommandCenter.prototype.unregisterCommandHook = function (name) {
	for (var i = 0; i < this.cmdHooks.length; i += 1) {
		var cmdHook = this.cmdHooks[i];

		if (cmdHook.name === name) {
			this.cmdHooks.splice(i, 1);
			return;
		}
	}
};


CommandCenter.prototype.sendCommand = function () {
	console.warn('CommandCenter#sendCommand: command system not yet set up.');
};


CommandCenter.prototype.resend = function () {
	console.warn('CommandCenter#resend: command system not yet set up.');
};


CommandCenter.prototype.discard = function () {
	console.warn('CommandCenter#discard: command system not yet set up.');
};


CommandCenter.prototype.queue = function () {
	console.warn('CommandCenter#queue: command system not yet set up.');
};


CommandCenter.prototype.piggyback = function () {
	console.warn('CommandCenter#piggyback: command system not yet set up.');
};


CommandCenter.prototype.simulateTransportError = function (type) {
	this.simulatedTransportError = type;
};

CommandCenter.prototype.simulateCommandError = function (cmdName, error) {
	this.simulatedCommandError = {
		cmdName: cmdName,
		error: error
	};
};

CommandCenter.prototype.setupCommandSystem = function (config) {
	if (this.commandSystemStarted) {
		return;
	}

	var hr = this.createTransport('http', config.httpOptions);

	var that = this;

	// if this timer is active, we're about to send batches.current (which may still grow).
	var timer = null;

	// if "streaming" is true, we will send batches.current the moment the running request returns.
	var streaming = false;

	// placeholder for unlock function, to avoid circular refs and upset jslint
	var unlock;

	var batches = {
		current: [],  // the commands we're building that will be sent _very_ soon
		sending: []   // the commands that are currently being sent
	};

	// "queueing" is true when user commands are to be stored in the current batch, and should be
	// sent off asap (through commandCenter.queue method)
	var queueing = false;

	// "piggybacking" is true when user commands are to be stored in the current batch (through
	// commandCenter.piggyback method)
	var piggybacking = false;

	// "locked" is true for as long as a queryId has not been successfully completed.
	var locked = false;


	function onCommandResponse(transportError, responses) {
		// this is the response to the request that is now in the batches.sending array
		// [
		//   [sysError] or:
		//   [null, userError] or:
		//   [null, null, response obj, events array] // where events may be left out
		// ]

		if (that.simulatedTransportError) {
			transportError = that.simulatedTransportError;
			that.simulatedTransportError = null;
		}

		if (transportError) {
			// "network": network failure (offline or timeout), retry is the only correct option
			// "busy": usually treat quietly

			return that.eventManager.emitEvent('io.error.' + transportError, {
				reason: transportError,
				info: responses
			});
		}

		// unlock the command system for the next user command(s)

		var batch = batches.sending;

		unlock();

		// from here on, handle all responses and drop the queue that we just received answers to

		that.eventManager.emitEvent('io.response');

		// handle the command responses

		for (var i = 0; i < responses.length; i += 1) {
			var response = responses[i];
			var cmd = batch[i];

			if (!cmd) {
				console.warn('No command found for response', response);
				continue;
			}

			var errorCode = response[0];
			var cmdResponse = response[1];
			var events = response[2];

			if (that.simulatedCommandError && that.simulatedCommandError.cmdName === cmd.name) {
				errorCode = that.simulatedCommandError.error;
				cmdResponse = null;
				events = null;
				that.simulatedCommandError = null;
			}

			if (events) {
				that.eventManager.emitEvents(events);
			}

			/*
			cmd = {
			  name: cmdName,
			  params: params,
			  files: files,
			  cb: cb
			};
			*/

			if (!errorCode) {
				that.eventManager.emit('io.' + cmd.name, cmdResponse, cmd.params);
			}

			if (cmd.cb) {
				if (errorCode) {
					cmd.cb(errorCode);
				} else {
					cmd.cb(null, cmdResponse);
				}
			}
		}
	}


	var nextFileId = 0;


	function sendBatch(batch) {
		// no need to check for locked here, since that is taken care of by the caller of sendBatch

		locked = true;
		timer = null;

		nextFileId = 0;

		var i, len;

		// prepare data extraction

		len = batch.length;

		var cmdNames = new Array(len);
		var cmdParams = new Array(len);
		var hasCallbacks = false;
		var header = [], data, files;

		for (i = 0; i < len; i += 1) {
			var cmd = batch[i];

			cmdNames[i] = cmd.name;
			cmdParams[i] = cmd.params;

			if (cmd.files) {
				if (!files) {
					files = {};
				}

				for (var fileId in cmd.files) {
					if (cmd.files.hasOwnProperty(fileId)) {
						files[fileId] = cmd.files[fileId];
					}
				}
			}

			if (cmd.cb) {
				hasCallbacks = true;
			}
		}

		data = cmdParams.join('\n');

		// execute all hooks

		for (i = 0, len = that.cmdHooks.length; i < len; i += 1) {
			var hook = that.cmdHooks[i];

			var hookOutput = hook.fn(data);
			if (hookOutput) {
				hookOutput.name = hook.name;

				header.push(hookOutput);
			}
		}

		// emit io.send event with all command names as the argument

		that.eventManager.emitEvent('io.send', cmdNames);

		// create a request

		var url = encodeURI(config.url + '/' + cmdNames.join(','));
		var urlParams = {};

		if (hasCallbacks) {
			urlParams.queryId = that.queryId;
		}

		// prepend the header before the cmd parameter data

		data = JSON.stringify(header) + '\n' + data;

		// send request to server

		if (files) {
			var FormData = window.FormData;

			if (FormData) {
				var form = new FormData();
				form.append('cmddata', data);

				for (var name in files) {
					if (files.hasOwnProperty(name)) {
						form.append(name, files[name]);
					}
				}

				data = form;
			} else {
				console.warn('window.FormData class not available, old browser?');
			}
		}


		hr.send('POST', url, urlParams, data, null, onCommandResponse);
	}


	function sendCurrentBatch() {
		batches.sending = batches.current;
		batches.current = [];

		// set streaming to false, a next user command can turn it on again

		streaming = false;

		sendBatch(batches.sending);
	}


	function scheduleCurrentBatch() {
		// - Set streaming to true, so nothing can pause us
		// - If no timer has been set yet, create a query ID, start a timer and prepare to
		//   send a new batch.

		streaming = true;

		if (locked) {
			// if the current stream is locked, the unlocking will trigger this function to be
			// called again.
			return;
		}

		if (timer === null) {
			that.queryId += 1;
			timer = window.setTimeout(sendCurrentBatch, 0);

			that.eventManager.emitEvent('io.queued', that.queryId);
		}
	}


	function resendBatch() {
		sendBatch(batches.sending);
	}


	unlock = function () {
		// discard the last sent batch

		batches.sending = [];

		locked = false;

		// if there is a batch ready to be sent again, trigger the send

		if (batches.current.length > 0 && streaming) {
			scheduleCurrentBatch();
		}
	};


	// file upload helpers

	var uploads;

	function Upload(file) {
		this.file = file;
	}

	Upload.prototype.toJSON = function () {
		// returns the ID of the file

		var id = '__file' + nextFileId;

		nextFileId += 1;

		if (!uploads) {
			uploads = {};
		}

		uploads[id] = this.file;

		return id;
	};


	var Blob = window.Blob;
	var File = window.File;
	var FileList = window.FileList;


	/**
	 * Use this method to transform a File, Blob or FileList object to an object type that commandCenter
	 * can upload. The result of this function may safely be put in of any parameter of a user
	 * command call.
	 *
	 * @param {File|Blob|FileList} file
	 * @param {boolean} silent          Set to true to suppress errors when the type doesn't match
	 * @returns {Upload|Upload[]}       An Upload instance, or an array of Upload instances
	 */

	this.transformUpload = function (file, silent) {
		if (file instanceof Blob || file instanceof File) {
			return new Upload(file);
		}

		if (file instanceof FileList) {
			var list = [];

			for (var i = 0; i < file.length; i += 1) {
				list.push(new Upload(file[i]));
			}

			return list;
		}

		if (!silent) {
			throw new TypeError('Given argument is not a Blob, File or FileList');
		}
	};


	/**
	 * This will deep-inspect any given object and transform File, Blob or FileList objects using
	 * the transformUpload method.
	 *
	 * @param {Object} obj
	 */

	this.transformEmbeddedUploads = function (obj) {
		var keys = Object.keys(obj || {});

		for (var i = 0; i < keys.length; i += 1) {
			var value = obj[keys[i]];

			if (value && typeof value === 'object') {
				var upload = this.transformUpload(value, true);

				if (upload) {
					obj[keys[i]] = upload;
				} else {
					this.transformEmbeddedUploads(obj[keys[i]]);
				}
			}
		}
	};


	this.sendCommand = function (cmdName, params, cb) {
		if (typeof cmdName !== 'string') {
			throw new TypeError('Command name is not a string: ' + cmdName);
		}

		if (params && typeof params !== 'object') {
			throw new TypeError('Command params is not an object: ' + params);
		}

		if (cb && typeof cb !== 'function') {
			throw new TypeError('Command callback is not a function: ' + cb);
		}

		// cmdName is dot notation "moduleName.commandName"

		// Serialize the params instantly, so that they may be altered right after this call without
		// affecting command execution. The uploads list should be reset before, and after
		// stringification.

		uploads = null;

		params = JSON.stringify(params);

		// create the command object

		var cmd = {
			name: cmdName,
			params: params,
			files: uploads,
			cb: cb
		};

		uploads = null;


		if (piggybacking) {
			// Add the command to the current queue, but don't start sending anything just yet.
			// The next batch that gets scheduled will take these along.

			batches.current.push(cmd);
		} else if (locked) {
			// We're currently sending, but if the next batch is accessible, we can add the command
			// to it. That way it will be sent when the open request returns.

			if (queueing || that.cmdMode === 'free') {
				// add to current batch and make sure it will be sent off

				batches.current.push(cmd);

				scheduleCurrentBatch();
			} else {
				console.warn('Could not execute user command: busy.', cmd);

				that.eventManager.emitEvent('io.error.busy', {
					reason: 'busy',
					command: cmd,
					blockedBy: batches.sending
				});
			}
		} else {
			// The command can be executed right now, so add to the current batch and make sure it
			// will be sent off

			batches.current.push(cmd);

			scheduleCurrentBatch();
		}
	};


	// the discard function can be called if after a transport error, when do not want to retry
	// it will unlock the command center for the next user command

	this.discard = function () {
		unlock();
		that.eventManager.emitEvent('io.discarded');
	};


	this.resend = function () {
		if (!batches.sending.length) {
			console.warn('No commands to retry. Discarding instead.');
			that.discard();
			return;
		}

		that.eventManager.emitEvent('io.resend');

		resendBatch();
	};


	this.queue = function (fn) {
		queueing = true;
		fn();
		queueing = false;
	};


	this.piggyback = function (fn) {
		piggybacking = true;
		fn();
		piggybacking = false;
	};

	this.commandSystemStarted = true;
};
