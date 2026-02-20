import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { LibraryScreen } from '../screens/LibraryScreen'
import { TagLibraryScreen } from '../screens/TagLibraryScreen'
import type { MainStackParamList } from './types'

const Stack = createNativeStackNavigator<MainStackParamList>()

export function MainStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="LibraryHome"
        options={{ title: 'Library', headerShown: false }}
        component={LibraryScreen}
      />
      <Stack.Screen
        name="TagLibrary"
        options={{ headerShown: false }}
        component={TagLibraryScreen}
      />
    </Stack.Navigator>
  )
}
