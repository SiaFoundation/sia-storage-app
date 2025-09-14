import React from 'react'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { SettingsHomeScreen } from '../screens/SettingsHomeScreen'
import { HostListScreen } from '../screens/HostListScreen'
import { HostDetailScreen } from '../screens/HostDetailScreen'
import { SettingsIndexerScreen } from '../screens/SettingsIndexerScreen'
import { type SettingsStackParamList } from './types'

const Stack = createNativeStackNavigator<SettingsStackParamList>()

export function SettingsStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="SettingsHome"
        component={SettingsHomeScreen}
        options={{ title: 'Settings' }}
      />
      <Stack.Screen
        name="Hosts"
        component={HostListScreen}
        options={{ title: 'Hosts' }}
      />
      <Stack.Screen
        name="HostDetail"
        component={HostDetailScreen}
        options={{ title: 'Host' }}
      />
      <Stack.Screen
        name="Indexer"
        component={SettingsIndexerScreen}
        options={{ title: 'Indexer' }}
      />
    </Stack.Navigator>
  )
}
