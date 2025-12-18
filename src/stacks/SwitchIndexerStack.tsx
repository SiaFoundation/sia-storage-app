import React from 'react'
import { Pressable, StyleSheet } from 'react-native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { useNavigation } from '@react-navigation/native'
import { X } from 'lucide-react-native'
import { type SwitchIndexerStackParamList } from './types'
import { SwitchIndexerScreen } from '../screens/SwitchIndexerScreen'
import { SwitchRecoveryPhraseScreen } from '../screens/SwitchRecoveryPhraseScreen'
import { SwitchFinishedScreen } from '../screens/SwitchFinishedScreen'
import { palette } from '../styles/colors'

const Stack = createNativeStackNavigator<SwitchIndexerStackParamList>()

function CloseButton() {
  const navigation = useNavigation()
  return (
    <Pressable
      onPress={() => navigation.getParent()?.goBack()}
      style={styles.closeButton}
      hitSlop={12}
    >
      <X size={24} color={palette.gray[100]} />
    </Pressable>
  )
}

export function SwitchIndexerStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: true,
        headerStyle: styles.header,
        headerTintColor: palette.gray[50],
        headerRight: () => <CloseButton />,
        headerBackVisible: true,
      }}
    >
      <Stack.Screen
        name="SwitchIndexer"
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
