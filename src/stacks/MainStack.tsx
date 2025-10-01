import React from 'react'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { FileListScreen } from '../screens/FileListScreen'
import { FileDetailScreen } from '../screens/FileDetailScreen'
import { ImportFileScreen } from '../screens/ImportFileScreen'
import { type MainStackParamList } from './types'

const Stack = createNativeStackNavigator<MainStackParamList>()

export function MainStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="Home"
        options={{ headerShown: false }}
        component={FileListScreen}
      />
      <Stack.Screen
        name="FileDetail"
        component={FileDetailScreen}
        options={{ title: 'Media' }}
      />
      <Stack.Screen
        name="ImportFile"
        component={ImportFileScreen}
        options={{ title: 'Import File' }}
      />
    </Stack.Navigator>
  )
}
