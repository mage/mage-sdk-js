var Mage = require('./lib/Mage');
var config = typeof window === 'undefined' ? global.mageConfig : window.mageConfig;

module.exports = new Mage(config);
