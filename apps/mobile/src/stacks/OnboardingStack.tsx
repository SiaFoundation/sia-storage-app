import { createNativeStackNavigator } from '@react-navigation/native-stack'
import OnboardingFinishedScreen from '../screens/OnboardingFinishedScreen'
import OnboardingIndexerScreen from '../screens/OnboardingIndexerScreen'
import OnboardingRecoveryPhraseScreen from '../screens/OnboardingRecoveryPhraseScreen'
import OnboardingWelcomeScreen from '../screens/OnboardingWelcomeScreen'
import type { OnboardingStackParamList } from './types'

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
