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

## Configuring Webpack (browser)

> webpack.config.js

```javascript
'use strict';

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
	}
};
```

## Additional application setup (server)

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
