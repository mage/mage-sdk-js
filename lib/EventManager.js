var EventEmitter = require('events.js');
var inherits = require('inherits');


function EventManager() {
	EventEmitter.call(this);
}

inherits(EventManager, EventEmitter);

module.exports = EventManager;


function parsePath(path) {
	if (typeof path === 'string') {
		if (path.length === 0) {
			throw new Error('An empty path is not a valid event path');
		}

		return path.split('.');
	}

	if (Array.isArray(path)) {
		if (path.length === 0) {
			throw new Error('An empty path is not a valid event path');
		}

		// make a copy, because we'll be mutating it
		return path.slice();
	}

	throw new TypeError('An event path must be a non-empty array or a string');
}


function createPathFamily(path) {
	// longest paths first

	var family = [];

	path = parsePath(path);

	while (path.length > 0) {
		family.push(path.join('.'));
		path.pop();
	}

	return family;
}


EventManager.prototype.emitEvent = function (fullPath, params) {
	// accepts only a single params object (which may be of any type)

	var paths = createPathFamily(fullPath);

	for (var i = 0; i < paths.length; i += 1) {
		this.emit(paths[i], fullPath, params);
	}
};


EventManager.prototype.emitEvents = function (events) {
	for (var i = 0; i < events.length; i += 1) {
		var evt = events[i];

		if (evt) {
			this.emitEvent(evt[0], evt[1]); // magic array positions: path, params
		}
	}
};
