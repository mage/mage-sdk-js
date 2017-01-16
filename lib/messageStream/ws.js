var EventEmitter = require('events.js');
var inherits = require('inherits');


function normalizeWsUrl(str) {
	if (str.indexOf('http') === -1) {
		// trim left slash from str

		if (str[0] !== '/') {
			str = '/' + str;
		}

		// make a full URL

		var location = window.location;

		str = location.protocol + '//' + location.host + str;  // host includes port
	}

	// switch protocols
	return str.replace(/^http/, 'ws');
}


function WebSocketClient(cfg) {
	EventEmitter.call(this);

	var that = this;
	var ws = null;
	var isOpen = false;
	var confirmIds = [];

	var afterRequestInterval = cfg.afterRequestInterval || 100;
	var afterErrorInterval = cfg.afterErrorInterval || 5000;

	var endpoint = normalizeWsUrl(cfg.url);
	var sessionKey;


	function attemptReconnect(interval) {
		setTimeout(function () {
			that.start();
		}, interval);
	}


	this.setSessionKey = function (key) {
		sessionKey = key;
	};


	this.start = function () {
		// restart, since setup has probably changed

		this.abort();

		try {
			var url = endpoint;
			if (sessionKey) {
				if (url.indexOf('?') === -1) {
					url += '?sessionKey=' + encodeURIComponent(sessionKey);
				} else {
					url += '&sessionKey=' + encodeURIComponent(sessionKey);
				}
			}

			ws = new window.WebSocket(url);
		} catch (error) {
			// see: https://developer.mozilla.org/en-US/docs/WebSockets/Writing_WebSocket_client_applications
			console.error('Possible security violation (aborting):', error);
			return false;
		}

		ws.onopen = function () {
			isOpen = true;
		};

		ws.onmessage = function (evt) {
			var msg = evt.data;

			try {
				msg = JSON.parse(msg);
			} catch (parseError) {
				that.emit('error', parseError, msg);
				return;
			}

			for (var i = 0; i < confirmIds.length; i++) {
				var id = confirmIds[i];
				if (msg[id]) {
					delete msg[id];
				}
			}

			that.emit('delivery', msg);
		};

		ws.onclose = function (evt) {
			// https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent
			// errors are >=1002

			isOpen = false;
			ws = null;

			if (evt.code && evt.code >= 1002) {
				that.emit('error', { error: evt.code, data: evt.reason });

				attemptReconnect(afterErrorInterval);
			} else {
				attemptReconnect(afterRequestInterval);
			}
		};

		return true;
	};


	this.confirm = function (msgId) {
		confirmIds.push(msgId);

		if (ws && isOpen) {
			ws.send(confirmIds.join(','));
			confirmIds = [];
		}
	};


	this.getUnconfirmed = function () {
		return confirmIds.slice();
	};


	this.abort = function () {
		if (ws) {
			ws.onclose = null;
			ws.close();
			ws = null;
		}

		isOpen = false;
	};


	this.destroy = function () {
		this.abort();
		this.removeAllListeners();
	};
}

inherits(WebSocketClient, EventEmitter);


exports.test = function (cfg) {
	return (cfg.url && window.WebSocket) ? true : false;
};

exports.create = function (cfg) {
	return new WebSocketClient(cfg);
};
