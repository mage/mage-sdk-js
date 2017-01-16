var msgStream = require('./messageStream');


function MsgServer(eventManager) {
	this.futureLog = {};	// queues up events for soon or immediate emission
	this.expectedMsgId = null;
	this.stream = null;
	this.sessionKey = null;

	this.eventManager = eventManager;
}

module.exports = MsgServer;


/**
 * Queues up messages for later emission
 * @param {Object} messages
 */

MsgServer.prototype.addMessages = function (messages) {
	if (!messages) {
		return;
	}

	if (typeof messages !== 'object') {
		throw new TypeError('Messages passed must be an object');
	}

	var msgIds = Object.keys(messages);

	for (var i = 0; i < msgIds.length; i += 1) {
		var msgId = msgIds[i];
		var msgIdNum = parseInt(msgId, 10);

		// register the message into the futureLog for later emission

		this.futureLog[msgId] = messages[msgId];

		// tell the message stream it may confirm this message as delivered

		if (this.stream && this.stream.confirm) {
			this.stream.confirm(msgId);
		}

		// make sure we are expecting the lowest possible msgId first

		if (msgIdNum !== 0 && (this.expectedMsgId === null || msgIdNum < this.expectedMsgId)) {
			this.expectedMsgId = msgIdNum;
		}
	}
};


/**
 * Forgets about all currently registered messages. Required after a session key change.
 */

MsgServer.prototype.resetFutureLog = function () {
	this.expectedMsgId = null;
	this.futureLog = {};
};


MsgServer.prototype.emitEvents = function (msgId) {
	var messages = this.futureLog[msgId];

	delete this.futureLog[msgId];

	// Emit the events in the message pack.

	if (messages) {
		this.eventManager.emitEvents(messages);
	}
};


/**
 * Emits as many messages as can be emitted without creating gaps in the flow of msgId keys
 */

MsgServer.prototype.emitFutureLog = function () {
	// Keep emitting until we encounter a gap, or futureLog has simply gone empty

	while (this.expectedMsgId && this.futureLog.hasOwnProperty(this.expectedMsgId)) {
		// Early increment expectedMsgId, so that even if an event listener were to throw, the next
		// time we call emitFutureLog, we know that we won't be expecting an old ID.

		var msgId = this.expectedMsgId;

		this.expectedMsgId += 1;

		this.emitEvents(msgId);
	}

	// finally emit any events that don't have an ID and thus don't need confirmation and lack order

	if (this.futureLog.hasOwnProperty('0')) {
		this.emitEvents('0');
	}
};


/**
 * Kills the stream connection. Can be resumed later by calling start().
 */

MsgServer.prototype.abort = function () {
	if (this.stream) {
		this.stream.abort();
	}
};


/**
 * Starts or resumes (after abort() had been called) the stream connection.
 */

MsgServer.prototype.start = function () {
	if (!this.stream) {
		throw new Error('The message stream has not yet been set up');
	}

	this.stream.start();
};


/**
 * Configures the message stream's transport types
 *
 * @param {Object} cfg
 * @return {boolean}       Returns true if succeeded to set up a transport, false otherwise.
 */

MsgServer.prototype.setupMessageStream = function (cfg) {
	if (!cfg) {
		return false;
	}

	var that = this;
	var confirmIds = [];

	// instantiate the event stream if needed

	if (this.stream) {
		confirmIds = this.stream.getUnconfirmed();

		this.stream.destroy();
		this.stream = null;
	}

	var stream = msgStream.create(cfg);
	if (!stream) {
		return false;
	}

	stream.on('error', function (error) {
		console.warn('Error from message stream transport:', error);
	});

	stream.on('delivery', function (messages) {
		try {
			that.addMessages(messages);
			that.emitFutureLog();
		} catch (error) {
			console.error('Error during message stream event emission:', error);
		}
	});

	if (this.sessionKey) {
		stream.setSessionKey(this.sessionKey);
	}

	for (var i = 0; i < confirmIds.length; i += 1) {
		stream.confirm(confirmIds[i]);
	}

	this.stream = stream;

	return true;
};


MsgServer.prototype.setSessionKey = function (sessionKey) {
	if (!this.stream) {
		throw new Error('The message stream has not yet been set up');
	}

	// Make sure any lingering messages are wiped out

	if (sessionKey !== this.sessionKey) {
		this.resetFutureLog();
		this.sessionKey = sessionKey;
	}

	this.stream.setSessionKey(sessionKey);
};

