import React from 'react'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { MainStack } from './MainStack'
import { SettingsStack } from './SettingsStack'
import { type RootTabParamList } from './types'
import { AuthStack } from './AuthStack'
import { useHasOnboardedStatus } from '../stores/app'
import { ImportStack } from './ImportStack'

const Tab = createBottomTabNavigator<RootTabParamList>()

export function RootTabs() {
  const hasOnboarded = useHasOnboardedStatus()
  // We should never reach this null because initApp() should have
  // already set this field true or false by the time we get here.
  if (hasOnboarded === undefined) {
    return null
  }
  if (!hasOnboarded) {
    return <AuthStack />
  }
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }}>
      <Tab.Screen name="MainTab" options={{ tabBarStyle: { display: 'none' } }}>
        {() => <MainStack />}
      </Tab.Screen>
      <Tab.Screen
        name="ImportTab"
        options={{ tabBarStyle: { display: 'none' } }}
      >
        {() => <ImportStack />}
      </Tab.Screen>
      <Tab.Screen
        name="SettingsTab"
        options={{ tabBarStyle: { display: 'none' } }}
      >
        {() => <SettingsStack />}
      </Tab.Screen>
    </Tab.Navigator>
  )
}
