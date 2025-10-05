import React from 'react'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { getFocusedRouteNameFromRoute } from '@react-navigation/native'
import { FolderIcon, SettingsIcon } from 'lucide-react-native'
import { MainStack } from './MainStack'
import { SettingsStack } from './SettingsStack'
import { type RootTabParamList } from './types'
import { AuthStack } from './AuthStack'
import { useHasOnboarded } from '../stores/settings'

const Tab = createBottomTabNavigator<RootTabParamList>()

export function RootTabs() {
  const hasOnboarded = useHasOnboarded()
  if (!hasOnboarded.data) {
    return <AuthStack />
  }
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }}>
      <Tab.Screen name="MainTab" options={{ tabBarStyle: { display: 'none' } }}>
        {() => <MainStack />}
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
