import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { DirectoryScreen } from '../screens/DirectoryScreen'
import { LibraryScreen } from '../screens/LibraryScreen'
import { SearchScreen } from '../screens/SearchScreen'
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
      <Stack.Screen
        name="DirectoryScreen"
        options={{ headerShown: false }}
        component={DirectoryScreen}
      />
      <Stack.Screen
        name="Search"
        options={{ headerShown: false, animation: 'fade', animationDuration: 100 }}
        component={SearchScreen}
      />
    </Stack.Navigator>
  )
}
