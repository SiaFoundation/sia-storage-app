import React from 'react'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { LibraryScreen } from '../screens/LibraryScreen'
import { FileDetailScreen } from '../screens/FileDetailScreen'
import { type MainStackParamList } from './types'

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
        name="FileDetail"
        component={FileDetailScreen}
        options={{ title: 'Media', headerShown: false }}
      />
    </Stack.Navigator>
  )
}
