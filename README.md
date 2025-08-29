# sia-starter-react-native

This repo contains a React Native + Sia starter app. The project demonstrates how to use the `react-native-sia` library to interact directly with the Sia host network.

## Install

```
bun install
```

## Setup iOS

Before running the app, make sure to have Xcode, Simulator, and CocoaPods installed and up to date.

```
bun run ios
```

## Setup Android

> 🚧 The Android target is not yet supported in `react-native-sia`. The library needs to to add Android artifacts to its release workflow.

Before running the app, make sure to have Java, Android Studio, and the Android SDK installed and up to date.

```
bun run android
```

## Setup Web

> 🚧 The web target is not yet supported in `react-native-sia`. The library needs a WASM-based entrypoint for browser environments.

React Native can also compile for the web.

```
bun run web
```

## Running the dev client

```
bun start
```
