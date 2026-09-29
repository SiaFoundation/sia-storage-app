// First, so a simulation's sim.json is read before the core's config loads.
import { simNetwork } from './src/testMode'
import { registerRootComponent } from 'expo'
import './polyfills'
import { logger, rustLogger } from '@siastorage/logger'
import { initSia, setLogger } from 'react-native-sia'
import { installGlobalErrorHandler } from './src/lib/globalErrorHandler'
import { Root } from './src/Root'
import type * as RemoteControlModule from './src/testMode/remoteControl'

installGlobalErrorHandler()

logger.info('app', 'initSia and uniffi...')

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
initSia().then(() => {
  if (__DEV__) {
    if (simNetwork) {
      // A require rather than an import, so a release bundle leaves out test
      // mode and the mock network client with it.
      const { startRemoteControl } =
        require('./src/testMode/remoteControl') as typeof RemoteControlModule
      startRemoteControl(simNetwork)
    }
  }
  logger.info('app', 'Initializing app...')
  setLogger(rustLogger, 'debug')
  registerRootComponent(Root)
  logger.info('app', 'App initialized')
})
