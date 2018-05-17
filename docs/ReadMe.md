# SDK Integration

This SDK uses **ES6 features** such as Promise.
Thus, if you want to **support older browsers** or use new EcmaScript features, you may want to build your application using Webpack. As the integration of Webpack is out of the scope of this ReadMe, please refer to the [Webpack documentation](https://webpack.js.org/concepts/).

# Server-side configuration

> lib/index.js

```javascript
mage.addModules([
	'config',
	// ... other built-in modules ...
])
```

To init the SDK, your MAGE server needs to expose the client config. Projects created
using `npx mage create` will have the config module configured by default.

Please see the [MAGE documentation](https://mage.github.io/mage#built-in-modules) for more information regarding the `config` module.

# Using the SDK

> www/index.js

```javascript
var mage = require('mage-sdk-js');

mage.setEndpoint('http://127.0.0.1:8080');

// Retrieve the configuration from MAGE
// and load all user commands

mage.configure(async (err) => {
	if (err) {
		console.error(err);
		return;
	}

	// You can register additional setup functions when adding modules;
	// here below, we add additional client-side code from external
	// modules. Make sure you add them on the server side as well!

	await mage.setupModule('session', require('mage-sdk-js.session'));
	await mage.setupModule('logger', require('mage-sdk-js.logger'));
	await mage.setupModule('time', require('mage-sdk-js.time'));
	await mage.setupModule('archivist', require('mage-sdk-js.archivist'));

	// Send a single command

	await mage.players.login();

	// Send a batch

	const results = await mage.batchCommands([
		mage.players.list(),
		mage.players.list(),
		mage.players.list()
	])
});
