import React from 'react'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { SettingsHomeScreen } from '../screens/SettingsHomeScreen'
import { HostListScreen } from '../screens/HostListScreen'
import { HostDetailScreen } from '../screens/HostDetailScreen'
import { SettingsIndexerScreen } from '../screens/SettingsIndexerScreen'
import { SettingsSyncScreen } from '../screens/SettingsSyncScreen'
import { SettingsSeedScreen } from '../screens/SettingsSeedScreen'
import { type SettingsStackParamList } from './types'
import { SettingsAdvancedScreen } from '../screens/SettingsAdvancedScreen'
import { SettingsLogsScreen } from '../screens/SettingsLogsScreen'

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
        name="HostDetail"
        component={HostDetailScreen}
        options={{ title: 'Host' }}
      />
      <Stack.Screen
        name="Indexer"
        component={SettingsIndexerScreen}
        options={{ title: 'Indexer' }}
      />
      <Stack.Screen
        name="Sync"
        component={SettingsSyncScreen}
        options={{ title: 'Sync' }}
      />
      <Stack.Screen
        name="Seed"
        component={SettingsSeedScreen}
        options={{ title: 'Seed' }}
      />
      <Stack.Screen
        name="Logs"
        component={SettingsLogsScreen}
        options={{ title: 'Logs' }}
      />
      <Stack.Screen
        name="Hosts"
        component={HostListScreen}
        options={{ title: 'Hosts' }}
      />
      <Stack.Screen
        name="Advanced"
        component={SettingsAdvancedScreen}
        options={{ title: 'Advanced' }}
      />
    </Stack.Navigator>
  )
}
