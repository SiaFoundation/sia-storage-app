import { registerRootComponent } from 'expo'
import './polyfills'
import App from './src/App'
import { initSia, setLogger } from 'react-native-sia'
import { rustLogger } from './src/lib/logger'

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
initSia().then(() => {
  setLogger(rustLogger, 'debug')
  registerRootComponent(App)
})
