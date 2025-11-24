fastlane documentation
----

# Installation

Make sure you have the latest version of the Xcode command line tools installed:

```sh
xcode-select --install
```

For _fastlane_ installation instructions, see [Installing _fastlane_](https://docs.fastlane.tools/#installing-fastlane)

# Available Actions

## iOS

### ios dev_device

```sh
[bundle exec] fastlane ios dev_device
```

Build and install dev build on connected iOS device

### ios build_ipa

```sh
[bundle exec] fastlane ios build_ipa
```

Build and export iOS IPA for App Store

### ios distribute_app_store

```sh
[bundle exec] fastlane ios distribute_app_store
```

Upload iOS app to App Store Connect

### ios distribute_testflight

```sh
[bundle exec] fastlane ios distribute_testflight
```

Upload iOS app to TestFlight

----


## Android

### android distribute_play_store

```sh
[bundle exec] fastlane android distribute_play_store
```

Upload Android app to Google Play Store

### android distribute_internal

```sh
[bundle exec] fastlane android distribute_internal
```

Upload Android app to internal testing track

----

This README.md is auto-generated and will be re-generated every time [_fastlane_](https://fastlane.tools) is run.

More information about _fastlane_ can be found on [fastlane.tools](https://fastlane.tools).

The documentation of _fastlane_ can be found on [docs.fastlane.tools](https://docs.fastlane.tools).
