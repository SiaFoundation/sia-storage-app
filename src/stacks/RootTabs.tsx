import React from 'react'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { HomeIcon, SettingsIcon } from 'lucide-react-native'
import { MainStack } from './MainStack'
import { SettingsStack } from './SettingsStack'
import { type RootTabParamList } from './types'
import { AuthStack } from './AuthStack'
import { useHasOnboarded } from '../stores/settings'

const Tab = createBottomTabNavigator<RootTabParamList>()

export function RootTabs() {
  const hasOnboarded = useHasOnboarded()
  if (!hasOnboarded) {
    return <AuthStack />
  }
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          height: 49,
          paddingBottom: 4,
          paddingTop: 4,
        },
        tabBarLabelStyle: { marginBottom: 0 },
        tabBarItemStyle: { paddingVertical: 0 },
      }}
    >
      <Tab.Screen
        name="MainTab"
        options={{
          tabBarLabel: 'Home',
          tabBarIcon: ({ color, size }) => (
            <HomeIcon color={color} size={size} />
          ),
        }}
      >
        {() => <MainStack />}
      </Tab.Screen>
      <Tab.Screen
        name="SettingsTab"
        options={{
          tabBarLabel: 'Settings',
          tabBarIcon: ({ color, size }) => (
            <SettingsIcon color={color} size={size} />
          ),
        }}
      >
        {() => <SettingsStack />}
      </Tab.Screen>
      <Tab.Screen
        name="LogsTab"
        options={{
          tabBarLabel: 'Logs',
          tabBarIcon: ({ color, size }) => (
            <TerminalIcon color={color} size={size} />
          ),
        }}
      >
        {() => <LogScreen />}
      </Tab.Screen>
    </Tab.Navigator>
  )
}
