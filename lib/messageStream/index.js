var transports = {
	longpolling: require('./http').longpolling,
	shortpolling: require('./http').shortpolling,
	websocket: require('./ws')
};


exports.transports = transports;


/**
 * Creates a stream over which we can receive messages asynchronously
 *
 * @param {Object} config     Configuration for the message stream system
 * @returns {Object}          The stream instance, or undefined if none is usable
 */

exports.create = function (config) {
	var detect = config.detect || [];

	for (var i = 0; i < detect.length; i += 1) {
		var type = detect[i];
		var cfg = config.transports[type] || {};

		var transport = transports[type];

		if (!transport) {
			console.log('Unrecognized transport type:', type, '(skipping)');
			continue;
		}

		if (transport.test(cfg)) {
			return transport.create(cfg);
		}
	}

	console.warn('Could not create any transport out of:', detect);
};

