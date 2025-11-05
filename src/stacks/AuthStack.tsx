import React from 'react'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import type { AuthStackParamList } from './types'
import WelcomeScreen from '../screens/WelcomeScreen'
import RecoveryPhraseScreen from '../screens/RecoveryPhraseScreen'
import ChooseIndexerScreen from '../screens/ChooseIndexerScreen'
import FinishedOnboardingScreen from '../screens/FinishedOnboardingScreen'

const Stack = createNativeStackNavigator<AuthStackParamList>()

export function AuthStack() {
  return (
    <Stack.Navigator initialRouteName="Welcome">
      <Stack.Screen name="Welcome" options={{ headerShown: false }}>
        {() => <WelcomeScreen />}
      </Stack.Screen>
      <Stack.Screen name="RecoveryPhrase" options={{ headerShown: false }}>
        {() => <RecoveryPhraseScreen />}
      </Stack.Screen>
      <Stack.Screen name="ChooseIndexer" options={{ headerShown: false }}>
        {() => <ChooseIndexerScreen />}
      </Stack.Screen>
      <Stack.Screen name="FinishedOnboarding" options={{ headerShown: false }}>
        {() => <FinishedOnboardingScreen />}
      </Stack.Screen>
    </Stack.Navigator>
  )
}
