import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useCallback } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import BlocksLoader from '../components/BlocksLoader'
import { Button } from '../components/Button'
import { IndexerSelector } from '../components/IndexerSelector'
import { SettingsScrollLayout } from '../components/SettingsLayout'
import { useChangeIndexer } from '../hooks/useChangeIndexer'
import type { SwitchIndexerStackParamList } from '../stacks/types'
import { palette } from '../styles/colors'

type Props = NativeStackScreenProps<
  SwitchIndexerStackParamList,
  'SwitchIndexer'
>

export function SwitchIndexerScreen({ navigation }: Props) {
  const { newIndexerInputProps, connectToIndexer, isWaiting, hasErrored } =
    useChangeIndexer()

  const trimmedValue = newIndexerInputProps.value.trim()
  const isInputEmpty = trimmedValue.length === 0

  const handleContinue = useCallback(async () => {
    const result = await connectToIndexer()
    if (result.status === 'connected') {
      // Already registered with this indexer, skip to finished.
      navigation.navigate('SwitchFinished', { indexerURL: trimmedValue })
    } else if (result.status === 'needsMnemonic') {
      // Need mnemonic entry.
      navigation.navigate('SwitchRecoveryPhrase', { indexerURL: trimmedValue })
    }
    // If error, stay on screen, error already shown via toast.
  }, [connectToIndexer, trimmedValue, navigation])

  if (isWaiting) {
    return (
      <View style={styles.loadingContainer}>
        <BlocksLoader colorStart={1} size={20} />
        <Text style={styles.waitingText}>Connecting...</Text>
      </View>
    )
  }

  return (
    <SettingsScrollLayout style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.subtitle}>
          Select an indexer to connect to. You will need to enter your recovery
          phrase to complete the switch.
        </Text>

        <IndexerSelector
          value={newIndexerInputProps.value}
          onChangeText={newIndexerInputProps.onChangeText}
          hasErrored={hasErrored}
        />

        <Button onPress={handleContinue} disabled={isInputEmpty}>
          Authorize
        </Button>
      </View>
    </SettingsScrollLayout>
  )
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 24,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.gray[950],
    gap: 24,
  },
  content: {
    gap: 16,
    paddingVertical: 24,
  },
  subtitle: {
    color: palette.gray[300],
    fontSize: 14,
    lineHeight: 20,
  },
  waitingText: {
    color: 'white',
    fontSize: 14,
  },
})
