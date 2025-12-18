import React from 'react'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { SettingsHomeScreen } from '../screens/SettingsHomeScreen'
import { HostListScreen } from '../screens/HostListScreen'
import { HostDetailScreen } from '../screens/HostDetailScreen'
import { SettingsIndexerScreen } from '../screens/SettingsIndexerScreen'
import { SettingsSyncScreen } from '../screens/SettingsSyncScreen'
import { type SettingsStackParamList } from './types'
import { SettingsAdvancedScreen } from '../screens/SettingsAdvancedScreen'
import { SettingsLogsScreen } from '../screens/SettingsLogsScreen'
import { SettingsDebugScreen } from '../screens/SettingsDebugScreen'
import { SwitchIndexerStack } from './SwitchIndexerStack'
import { StyleSheet } from 'react-native'
import { palette } from '../styles/colors'

const Stack = createNativeStackNavigator<SettingsStackParamList>()

export function SettingsStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: true,
        headerStyle: styles.header,
        headerTintColor: palette.gray[50],
      }}
    >
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
      <Stack.Screen
        name="Debug"
        component={SettingsDebugScreen}
        options={{ title: 'Debug' }}
      />
      <Stack.Group screenOptions={{ presentation: 'fullScreenModal' }}>
        <Stack.Screen
          name="SwitchIndexer"
          component={SwitchIndexerStack}
          options={{ headerShown: false }}
        />
      </Stack.Group>
    </Stack.Navigator>
  )
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: palette.gray[950],
  },
})
