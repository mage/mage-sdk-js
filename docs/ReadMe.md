# Using the MAGE Web SDK

## Integrating client-configuration

Assuming you have bootstrapped a MAGE server application, you need to make sure that the MAGE client-configuration ends
up in your build. The configuration for the browser application can be extracted from the `mage` object, by calling its
`mage.getClientConfig(appName)` method. How you integrate the returned object into your build is up to you.

- You can write the configuration to a JSON file that your build system picks up and embeds.
- You can host the JSON on an HTTP endpoint.
- You can have both client-code and server-code in a single repository, and integrate the build system into it.

Which approach you take will depend on your desired workflow. In the [integrations](./integrations) folder we provide
examples for specific build systems.

## Setting up the MAGE Web SDK runtime

Once you have integrated the MAGE Web SDK, you need to register any modules you wish to use with MAGE, and run their
asynchronous `exports.setup(callback)` methods.

It is important to note that for some modules you will probably want to delay their setup phase until after a user has
been logged in and has a session. This is a common pattern, because often user data should not be read by users who do
not own that data. On top of that, users should be able to invoke server-logic in the secure knowledge that others
cannot invoke that logic on their behalf.

You can achieve this by following these steps:

1. Register all modules (`mage.addModule()`) that are required to log a user in.
2. Optionally, you may register modules that do not require a user to be logged in.
3. Call `mage.setup()` to invoke the one-time setup logic of the registered modules to make sure they are usable.
4. Log the user in via *your* user command (see example below) and wait for its callback to be called.
5. If present, handle the error that the login callback may have received as its first argument.

Now that the user has been logged in:

1. Register all remaining modules that required login to be usable.
2. Call `mage.setup()` to invoke the one-time setup logic of all newly registered modules to make sure they are usable.

We have effectively split up module registrations into two phases. It is perfectly safe to do this, and you can call
`mage.setup()` as often as you need to (once per phase), since it will only set up those modules that have not been set
up yet.

## Example

> www/index.js

```javascript
var mage = require('mage-sdk-js');

// register and set up all modules that don't require login

mage.addModule('session', require('mage-sdk-js.session'));
mage.addModule('logger', require('mage-sdk-js.logger'));
mage.addModule('time', require('mage-sdk-js.time'));
mage.addModule('archivist', require('mage-sdk-js.archivist'));
mage.addModule('user', require('../lib/modules/user/client'));

mage.setup(function (error) {
	// authenticate the user

	mage.user.login(function (error) {
		// register and setup all modules that require login

		mage.addModule('missions', require('../lib/modules/missions/client'));

		mage.setup(function (error) {
			// All done!

			console.log(mage.missions.getMissionProgress());
		});
	});
});
```
