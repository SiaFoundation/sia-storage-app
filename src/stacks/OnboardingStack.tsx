import React from 'react'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import type { OnboardingStackParamList } from './types'
import OnboardingWelcomeScreen from '../screens/OnboardingWelcomeScreen'
import OnboardingRecoveryPhraseScreen from '../screens/OnboardingRecoveryPhraseScreen'
import OnboardingIndexerScreen from '../screens/OnboardingIndexerScreen'
import OnboardingFinishedScreen from '../screens/OnboardingFinishedScreen'

const Stack = createNativeStackNavigator<OnboardingStackParamList>()

export function OnboardingStack() {
  return (
    <Stack.Navigator initialRouteName="Welcome">
      <Stack.Screen name="Welcome" options={{ headerShown: false }}>
        {() => <OnboardingWelcomeScreen />}
      </Stack.Screen>
      <Stack.Screen name="ChooseIndexer" options={{ headerShown: false }}>
        {() => <OnboardingIndexerScreen />}
      </Stack.Screen>
      <Stack.Screen name="RecoveryPhrase" options={{ headerShown: false }}>
        {() => <OnboardingRecoveryPhraseScreen />}
      </Stack.Screen>
      <Stack.Screen name="FinishedOnboarding" options={{ headerShown: false }}>
        {() => <OnboardingFinishedScreen />}
      </Stack.Screen>
    </Stack.Navigator>
  )
}
