var cachepuncher = require('cachepuncher');
var deepCopy = require('wizcorp-deep-copy.js');


function addParamsToUrl(url, params) {
	if (!params) {
		return url;
	}

	var keys = Object.keys(params);
	var count = keys.length;

	if (count === 0) {
		return url;
	}

	var splitter = url.indexOf('?') === -1 ? '?' : '&';

	for (var i = 0; i < count; i += 1) {
		var key = keys[i];

		url += splitter + encodeURIComponent(key) + '=' + encodeURIComponent(params[key]);

		splitter = '&';
	}

	return url;
}


// safe XHR data extractors (will not throw)

function getStatusCode(xhr) {
	var status;

	try {
		status = xhr.status;
	} catch (error) {
		return 0;
	}

	// IE CORS compatibility

	if (typeof status !== 'number') {
		status = 200;
	}

	return status;
}


function getResponseText(xhr) {
	var response;

	try {
		response = xhr.responseText;
	} catch (error) {
		// do nothing, we'll return undefined
	}

	return response;
}


function getContentType(xhr) {
	var type;

	try {
		type = xhr.contentType;
	} catch (error) {
		// ignore, we'll try getResponseHeader
	}

	if (!type) {
		try {
			type = xhr.getResponseHeader('content-type');
		} catch (getError) {
			// ignore, we'll return undefined
		}
	}

	return type;
}


function createCORSRequest() {
	var xhr = new XMLHttpRequest();
	if ('withCredentials' in xhr) {
		// XHR for Chrome/Firefox/Opera/Safari.
		return xhr;
	}

	if (window.XDomainRequest) {
		// XDomainRequest for IE.
		return new window.XDomainRequest();
	}

	return xhr;
}

function HttpRequest(options) {
	options = options || {};

	var xhr = createCORSRequest();

	var callback;
	var isSending = false;
	var timer;
	var FormData = window.FormData;


	this.isBusy = function () {
		return isSending;
	};


	this.send = function (method, url, params, data, headers, cb) {
		if (typeof method !== 'string') {
			throw new TypeError('method is not a string: ' + method);
		}

		if (typeof url !== 'string') {
			throw new TypeError('url is not a string: ' + url);
		}

		if (params && typeof params !== 'object') {
			throw new TypeError('params is not an object: ' + params);
		}

		if (headers && typeof headers !== 'object') {
			throw new TypeError('headers is not an object: ' + headers);
		}

		if (isSending) {
			if (cb) {
				cb('busy');
			}

			return false;
		}

		isSending = true;
		callback = cb;

		headers = headers || {};

		var m = url.match(/^[a-z]+:(\/\/)([^:]+:[^:]+)@/i);
		if (m) {
			headers.Authorization = 'Basic ' + window.btoa(m[2]);
		}

		if (params) {
			if (options.noCache) {
				params = deepCopy(params);
				params.rand = cachepuncher.punch();
			}

			url = addParamsToUrl(url, params);
		}

		xhr.open(method, url, true);

		if (options.withCredentials) {
			xhr.withCredentials = true;
		}

		if (data) {
			if (!FormData || !(data instanceof FormData)) {
				if (!headers.hasOwnProperty('content-type')) {
					var contentType;

					if (typeof data === 'string') {
						contentType = 'text/plain; charset=UTF-8';
					} else {
						contentType = 'application/json';
						data = JSON.stringify(data);
					}

					if ('setRequestHeader' in xhr) {
						xhr.setRequestHeader('content-type', contentType);
					}
				}
			}
		} else {
			data = null;
		}

		if ('setRequestHeader' in xhr) {
			for (var key in headers) {
				if (headers.hasOwnProperty(key)) {
					xhr.setRequestHeader(key, headers[key]);
				}
			}
		}

		if (options.timeout) {
			if (options.timeout < 1000) {
				throw new Error('Unreasonable timeout setting for HTTP request: ' + options.timeout + ' msec.');
			}

			timer = setTimeout(function () {
				var cb = callback;
				callback = null;

				console.warn('HTTP request timed out, aborting');

				xhr.abort();

				// in some browsers, oncomplete will now fire due to abort()
				// since callback is now null however, it will not do anything

				isSending = false;

				if (cb) {
					cb('network');
				}
			}, options.timeout);
		}

		xhr.send(data);

		return true;
	};


	this.abort = function () {
		// abort does not call any callbacks
		// useful for long polling

		callback = null;
		isSending = false;

		try {
			xhr.abort();
		} catch (abortError) {
			// ignore
			console.error(abortError);
		}
	};


	function oncomplete() {
		// possible error codes sent back to callback:
		// 'network': connection issue
		// 'maintenance': server is in maintenance

		isSending = false;

		if (!callback) {
			return;
		}

		var cb = callback;
		callback = null;

		// the two variables we'll return in the callback, possibly returned as undefined

		var error, response;

		// extract data from XHR

		var code = getStatusCode(xhr);
		var rawResponse = getResponseText(xhr);
		var contentType = getContentType(xhr);
		var codeCategory = (code / 100) >>> 0;

		// detect errors

		if (codeCategory !== 2) {
			// error situation

			if (code === 503) {
				error = 'maintenance';
			} else {
				error = 'network';
			}

			console.warn('HTTP response code:', code, 'set as error:', error);
		}

		// detect and parse response body

		if (rawResponse && contentType) {
			if (contentType.match(/^[a-z]+\/json/)) {
				try {
					response = JSON.parse(rawResponse);
				} catch (e) {
					console.warn('JSON parse error on HTTP response', e, rawResponse);

					error = error || 'server';
				}
			} else {
				response = rawResponse;
			}
		}

		cb(error, response);
	}

	function onLoad() {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}

		setTimeout(function () {
			oncomplete();
		}, 0);
	}

	if ('onload' in xhr) {
		xhr.onload = onLoad;
		xhr.onerror = onLoad;
	} else {
		xhr.onreadystatechange = function () {
			if (xhr.readyState === 4) {
				onLoad();
			}
		};
	}
}

module.exports = HttpRequest;
