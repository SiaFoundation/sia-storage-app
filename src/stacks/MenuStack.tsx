import React from 'react'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { MenuScreen } from '../screens/MenuScreen'
import { HostListScreen } from '../screens/HostListScreen'
import { HostDetailScreen } from '../screens/HostDetailScreen'
import { SettingsIndexerScreen } from '../screens/SettingsIndexerScreen'
import { SettingsSyncScreen } from '../screens/SettingsSyncScreen'
import { type MenuStackParamList } from './types'
import { SettingsAdvancedScreen } from '../screens/SettingsAdvancedScreen'
import { SettingsLogsScreen } from '../screens/SettingsLogsScreen'
import { SettingsDebugScreen } from '../screens/SettingsDebugScreen'
import { SwitchIndexerStack } from './SwitchIndexerStack'
import { LearnRecoveryPhraseScreen } from '../screens/learn/LearnRecoveryPhraseScreen'
import { LearnHowItWorksScreen } from '../screens/learn/LearnHowItWorksScreen'
import { LearnIndexerScreen } from '../screens/learn/LearnIndexerScreen'
import { LearnSiaNetworkScreen } from '../screens/learn/LearnSiaNetworkScreen'
import { StyleSheet } from 'react-native'
import { palette } from '../styles/colors'

const Stack = createNativeStackNavigator<MenuStackParamList>()

export function MenuStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: true,
        headerStyle: styles.header,
        headerTintColor: palette.gray[50],
      }}
    >
      <Stack.Screen
        name="MenuHome"
        component={MenuScreen}
        options={{ title: '' }}
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
      <Stack.Screen
        name="LearnRecoveryPhrase"
        component={LearnRecoveryPhraseScreen}
        options={{ title: 'Recovery Phrase' }}
      />
      <Stack.Screen
        name="LearnHowItWorks"
        component={LearnHowItWorksScreen}
        options={{ title: 'How Storage Works' }}
      />
      <Stack.Screen
        name="LearnIndexer"
        component={LearnIndexerScreen}
        options={{ title: 'What is an Indexer?' }}
      />
      <Stack.Screen
        name="LearnSiaNetwork"
        component={LearnSiaNetworkScreen}
        options={{ title: 'The Sia Network' }}
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
