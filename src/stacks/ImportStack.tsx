import React from 'react'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { ImportFileScreen } from '../screens/ImportFileScreen'
import { type ImportStackParamList } from './types'

const Stack = createNativeStackNavigator<ImportStackParamList>()

export function ImportStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="ImportFile"
        component={ImportFileScreen}
        options={{ title: 'Import File', headerShown: false }}
      />
    </Stack.Navigator>
  )
}
