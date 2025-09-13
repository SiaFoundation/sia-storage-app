import { registerRootComponent } from 'expo'
import './polyfills'
import { Root } from './src/Root'
import { initSia, setLogger } from 'react-native-sia'
import { logger, rustLogger } from './src/lib/logger'
import { initializeDB } from './src/db'

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
initSia().then(() => {
  logger.log('Initializing app...')
  setLogger(rustLogger, 'debug')
  registerRootComponent(Root)
  logger.log('App initialized')
  initializeDB()
})
