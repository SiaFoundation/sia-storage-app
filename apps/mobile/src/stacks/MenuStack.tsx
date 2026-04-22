import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { StyleSheet } from 'react-native'
import { LearnHowItWorksScreen } from '../screens/learn/LearnHowItWorksScreen'
import { LearnIndexerScreen } from '../screens/learn/LearnIndexerScreen'
import { LearnRecoveryPhraseScreen } from '../screens/learn/LearnRecoveryPhraseScreen'
import { LearnSiaNetworkScreen } from '../screens/learn/LearnSiaNetworkScreen'
import { MenuScreen } from '../screens/MenuScreen'
import { SettingsAdvancedScreen } from '../screens/SettingsAdvancedScreen'
import { SettingsImportScreen } from '../screens/SettingsImportScreen'
import { SettingsLogsScreen } from '../screens/SettingsLogsScreen'
import { palette } from '../styles/colors'
import { SwitchIndexerStack } from './SwitchIndexerStack'
import type { MenuStackParamList } from './types'

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
      <Stack.Screen name="MenuHome" component={MenuScreen} options={{ title: '' }} />
      <Stack.Screen name="Import" component={SettingsImportScreen} options={{ title: 'Import' }} />
      <Stack.Screen name="Logs" component={SettingsLogsScreen} options={{ title: 'Logs' }} />
      <Stack.Screen
        name="Advanced"
        component={SettingsAdvancedScreen}
        options={{ title: 'Developers' }}
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
