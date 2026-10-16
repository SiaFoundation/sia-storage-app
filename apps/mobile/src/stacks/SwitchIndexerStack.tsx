import { useNavigation } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { X } from 'lucide-react-native'
import { Pressable, StyleSheet } from 'react-native'
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context'
import { SwitchFinishedScreen } from '../screens/SwitchFinishedScreen'
import { SwitchIndexerScreen } from '../screens/SwitchIndexerScreen'
import { SwitchRecoveryPhraseScreen } from '../screens/SwitchRecoveryPhraseScreen'
import { palette } from '../styles/colors'
import type { SwitchIndexerStackParamList } from './types'

const Stack = createNativeStackNavigator<SwitchIndexerStackParamList>()

function CloseButton() {
  const navigation = useNavigation()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Close"
      onPress={() => navigation.getParent()?.goBack()}
      style={styles.closeButton}
      hitSlop={12}
    >
      <X size={24} color={palette.gray[100]} />
    </Pressable>
  )
}

// Shown as a full-screen modal, which is its own view controller, so the app's
// provider reports the main window's insets, not the modal's. A provider inside
// the modal reads its own, which on an iPhone Duo's cover screen include the
// status bar down the right edge.
export function SwitchIndexerStack() {
  return (
    <SafeAreaProvider>
      <SwitchIndexerNavigator />
    </SafeAreaProvider>
  )
}

function SwitchIndexerNavigator() {
  const { left, right } = useSafeAreaInsets()
  return (
    <Stack.Navigator
      screenOptions={{
        contentStyle: { paddingLeft: left, paddingRight: right },
        headerShown: true,
        headerStyle: styles.header,
        headerTintColor: palette.gray[50],
        headerRight: () => <CloseButton />,
        headerBackVisible: true,
      }}
    >
      <Stack.Screen
        name="SwitchIndexerHome"
        component={SwitchIndexerScreen}
        options={{
          title: 'Switch Indexer',
          headerBackVisible: false,
        }}
      />
      <Stack.Screen
        name="SwitchRecoveryPhrase"
        component={SwitchRecoveryPhraseScreen}
        options={{ title: 'Recovery Phrase' }}
      />
      <Stack.Screen
        name="SwitchFinished"
        component={SwitchFinishedScreen}
        options={{
          title: 'Complete',
          headerBackVisible: false,
        }}
      />
    </Stack.Navigator>
  )
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: palette.gray[950],
  },
  closeButton: {
    padding: 8,
  },
})
