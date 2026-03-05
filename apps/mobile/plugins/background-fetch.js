// Custom Expo config plugin for react-native-background-fetch on SDK 55+.
// The built-in iOS plugin fails because the AppDelegate changed from
// @UIApplicationMain to @main with ExpoReactNativeFactoryDelegate.
// This plugin patches the new format for iOS and reuses the built-in Android plugin.
const { withAppDelegate, withPlugins } = require('@expo/config-plugins')
const {
  mergeContents,
} = require('@expo/config-plugins/build/utils/generateCode')
const androidPlugin =
  require('react-native-background-fetch/expo/plugin/build/androidPlugin').default

function withBackgroundFetchIOS(config) {
  return withAppDelegate(config, (config) => {
    let src = config.modResults.contents

    src = mergeContents({
      tag: 'react-native-background-fetch-import',
      src,
      newSrc: 'import TSBackgroundFetch',
      anchor: /@main/,
      offset: -1,
      comment: '//',
    }).contents

    src = mergeContents({
      tag: 'react-native-background-fetch-didFinishLaunching',
      src,
      newSrc: '    TSBackgroundFetch.sharedInstance().didFinishLaunching()',
      anchor:
        /return super\.application\(application, didFinishLaunchingWithOptions: launchOptions\)/,
      offset: -1,
      comment: '//',
    }).contents

    config.modResults.contents = src
    return config
  })
}

function withBackgroundFetch(config) {
  return withPlugins(config, [
    [androidPlugin, {}],
    [withBackgroundFetchIOS, {}],
  ])
}

module.exports = withBackgroundFetch
