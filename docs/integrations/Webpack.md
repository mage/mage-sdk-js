# Integration with Webpack

This example shows how you can integrate the MAGE Web SDK with [Webpack](https://webpack.github.io/). Explaining
Webpack itself is out of scope of this documentation, so please read about Webpack before getting started.


## Testing your build configuration

You can make production and development builds using Webpack by running one of the following two commands.

> Production build

```shell
webpack -p
```

> Development build

```shell
webpack -d
```

If no errors appear, you will know your configuration worked and your project was built into the configured
build-folder.


## Getting started

Below, we will cover two patterns of using Webpack to build your web application using the MAGE Web SDK. While they have
a slightly different server-side approach, the implementation on the browser-side is identical for both patterns.


### Web SDK setup (browser)

This module configuration is important to the build process, since your build must include configuration for the Web
SDK. On the browser side, we will expose this configuration as a JSON-string that Webpack can inject using
`DefinePlugin`. The result is that we can set up the Web SDK as follows:

> www/index.js

```javascript
window.mageConfig = MAGE_CONFIG;    // Webpack will replace MAGE_CONFIG with a JSON-string

var mage = require('mage-sdk-js');  // mage will automatically pick up window.mageConfig
```

From here on, we can follow one of two patterns to configure Webpack.


## Pattern 1: Server and Client code in a separate codebase

### Extracting Web SDK configuration

Your application server will have to share configuration for the build. You can easily write a script that does the
following:

> scripts/exportClientConfig.js

```javascript
#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const mage = require('../lib');

const appName = 'game';
const filePath = path.join(__dirname, '../clientConfig.json');

const mageConfig = mage.getClientConfig(appName);

fs.writeFileSync(filePath, JSON.stringify(mageConfig), { encoding: 'utf8' });
```

You can then export the configuration to a file:

```shell
./scripts/exportClientConfig.js
```

### Configuring Webpack (server)

Make sure to copy the `clientConfig.json` file to the web project so that the Webpack configuration below can read it.
Because you need a fresh copy of this file every time the server code has changes in the user commands, you will
probably want to make this an automated step in your build-process.

> webpack.config.js

```javascript
'use strict';

const webpack = require('webpack');
const mage = require('./lib');

const mageConfig = fs.readFileSync('./clientConfig.json', { encoding: 'utf8' });

module.exports = {
	entry: {
		index: './www/index.js'
	},
	output: {
		path: './build',
		filename: '[name].js'
	},
	module: {
		loaders: [
			{ test: /\.css$/, loader: 'css-loader' },
			{ test: /\.html?$/, loader: 'html-loader' },
			{ test: /\.js$/, loader: 'strict-loader' }
		]
	},
	plugins: [
		new webpack.DefinePlugin({
			MAGE_CONFIG: mageConfig
		})
	]
};
```


## Pattern 2: Server and Client code in a single codebase

Alternatively, if your client-side and server-side code live in the same codebase, you don't have to save the client
configuration to a file. Your Webpack configuration file can ask MAGE directly for its configuration.

### Configuring Webpack (server)

> webpack.config.js

```javascript
'use strict';

const webpack = require('webpack');
const mage = require('./lib');

const appName = 'game';
const mageConfig = mage.getClientConfig(appName);

module.exports = {
	entry: {
		index: './www/index.js'
	},
	output: {
		path: './build',
		filename: '[name].js'
	},
	module: {
		loaders: [
			{ test: /\.css$/, loader: 'css-loader' },
			{ test: /\.html?$/, loader: 'html-loader' },
			{ test: /\.js$/, loader: 'strict-loader' }
		]
	},
	plugins: [
		new webpack.DefinePlugin({
			MAGE_CONFIG: JSON.stringify(mageConfig)
		})
	]
};
```

### Additional application setup (server)

If you want to serve the build using MAGE's built-in HTTP server, you can add the following lines to `lib/index.js`:

> lib/index.js

```javascript
// ...
// module setup
// ...

const urlPath = '/www-game';       // browse to /www-game ...
const buildPath = './build';       // ... to access files from ./build
const defaultFile = 'index.html';  // we serve index.html if the user browses to the url path (a folder)

mage.core.httpServer.serveFolder(urlPath, buildPath, defaultFile);
```
