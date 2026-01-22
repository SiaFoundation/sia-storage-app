import React from 'react'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { MainStack } from './MainStack'
import { MenuStack } from './MenuStack'
import { type RootTabParamList } from './types'
import { OnboardingStack } from './OnboardingStack'
import { useHasOnboarded } from '../stores/settings'
import { ImportStack } from './ImportStack'

const Tab = createBottomTabNavigator<RootTabParamList>()

export function RootTabs() {
  const hasOnboarded = useHasOnboarded()
  if (!hasOnboarded.data) {
    return <OnboardingStack />
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
        name="MenuTab"
        options={{ tabBarStyle: { display: 'none' } }}
      >
        {() => <MenuStack />}
      </Tab.Screen>
    </Tab.Navigator>
  )
}
