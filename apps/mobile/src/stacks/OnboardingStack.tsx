import { createNativeStackNavigator } from '@react-navigation/native-stack'
import OnboardingAdvancedIndexerScreen from '../screens/OnboardingAdvancedIndexerScreen'
import OnboardingFinishedScreen from '../screens/OnboardingFinishedScreen'
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
      <Stack.Screen name="AdvancedIndexer" options={{ headerShown: false }}>
        {() => <OnboardingAdvancedIndexerScreen />}
      </Stack.Screen>
      <Stack.Screen name="RecoveryPhrase" options={{ headerShown: false, gestureEnabled: false }}>
        {() => <OnboardingRecoveryPhraseScreen />}
      </Stack.Screen>
      <Stack.Screen
        name="FinishedOnboarding"
        options={{ headerShown: false, gestureEnabled: false }}
      >
        {() => <OnboardingFinishedScreen />}
      </Stack.Screen>
    </Stack.Navigator>
  )
}
