var HttpRequest = require('../HttpRequest');
var EventEmitter = require('events.js');
var inherits = require('inherits');


function HttpPollingClient(style, cfg) {
	EventEmitter.call(this);

	var that = this;

	var hr = new HttpRequest({
		noCache: true,
		withCredentials: cfg.cors && cfg.cors.credentials ? true : false
	});

	var lastError;
	var endpoint = cfg.url;
	var confirmIds = [];
	var sessionKey;

	var afterRequestInterval = cfg.afterRequestInterval || (style === 'shortpolling' ? 5000 : 0);
	var afterErrorInterval = cfg.afterErrorInterval || 5000;

	this.isRunning = false;

	var send;


	function scheduleNext() {
		if (!that.isRunning) {
			// nothing to schedule if we've been aborted
			return;
		}

		if (lastError) {
			setTimeout(send, afterErrorInterval);
		} else {
			setTimeout(send, afterRequestInterval);
		}
	}


	function ondone(error, response) {
		if (error) {
			lastError = error;

			that.emit('error', { error: error, data: response });
		} else {
			confirmIds = [];

			if (response !== null && typeof response === 'object') {
				that.emit('delivery', response);
			}
		}

		scheduleNext();
	}


	send = function () {
		if (!that.isRunning) {
			return;
		}

		lastError = null;

		var params = {
			transport: style
		};

		if (sessionKey) {
			params.sessionKey = sessionKey;
		}

		if (confirmIds.length > 0) {
			params.confirmIds = confirmIds.join(',');
		}

		// send the request

		hr.send('GET', endpoint, params, null, null, ondone);
	};


	this.setSessionKey = function (key) {
		sessionKey = key;
	};


	this.start = function () {
		if (this.isRunning) {
			// restart, since setup has probably changed

			hr.abort();

			setTimeout(function () {
				send();
			}, 0);
		} else {
			this.isRunning = true;

			send();
		}


		return true;
	};


	this.confirm = function (msgId) {
		confirmIds.push(msgId);
	};


	this.getUnconfirmed = function () {
		return confirmIds.slice();
	};


	this.abort = function () {
		hr.abort();
		this.isRunning = false;
	};


	this.destroy = function () {
		this.abort();
		this.removeAllListeners();
	};
}

inherits(HttpPollingClient, EventEmitter);


exports.longpolling = {
	test: function (cfg) {
		return cfg.url ? true : false;
	},
	create: function (cfg) {
		return new HttpPollingClient('longpolling', cfg);
	}
};

exports.shortpolling = {
	test: function (cfg) {
		return cfg.url ? true : false;
	},
	create: function (cfg) {
		return new HttpPollingClient('shortpolling', cfg);
	}
};
