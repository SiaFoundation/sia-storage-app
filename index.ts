import { registerRootComponent } from 'expo'
import './polyfills'
import App from './src/App'
import { initSia } from 'react-native-sia'

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
initSia().then(() => {
  registerRootComponent(App)
})
