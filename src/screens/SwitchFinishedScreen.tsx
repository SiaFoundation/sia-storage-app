import React, { useCallback } from 'react'
import { StyleSheet, View, Text } from 'react-native'
import { type NativeStackScreenProps } from '@react-navigation/native-stack'
import { type SwitchIndexerStackParamList } from '../stacks/types'
import { palette } from '../styles/colors'
import { Button } from '../components/Button'
import { useToast } from '../lib/toastContext'
import { SettingsScrollLayout } from '../components/SettingsLayout'

type Props = NativeStackScreenProps<
  SwitchIndexerStackParamList,
  'SwitchFinished'
>

export function SwitchFinishedScreen({ navigation, route }: Props) {
  const { indexerURL } = route.params
  const toast = useToast()

  const handleComplete = useCallback(() => {
    toast.show('Switched to new indexer')
    // Dismiss the modal stack.
    navigation.getParent()?.goBack()
  }, [toast, navigation])

  return (
    <SettingsScrollLayout style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>All set!</Text>
        <Text style={styles.subtitle}>
          You are now connected to the new indexer and ready to continue using
          Sia Storage.
        </Text>
        <Text style={styles.urlLabel}>Connected to:</Text>
        <Text style={styles.url}>{indexerURL}</Text>
      </View>

      <View style={styles.footer}>
        <Button onPress={handleComplete}>Done</Button>
      </View>
    </SettingsScrollLayout>
  )
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 24,
  },
  content: {
    gap: 16,
    paddingVertical: 48,
    alignItems: 'center',
  },
  title: {
    color: palette.gray[100],
    fontSize: 28,
    fontWeight: '800',
    textAlign: 'center',
  },
  subtitle: {
    color: palette.gray[300],
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  urlLabel: {
    color: palette.gray[500],
    fontSize: 12,
    marginTop: 16,
  },
  url: {
    color: palette.gray[100],
    fontSize: 14,
  },
  footer: {
    paddingVertical: 24,
  },
})
