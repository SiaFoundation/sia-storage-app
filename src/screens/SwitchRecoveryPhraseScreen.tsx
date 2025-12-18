import React, { useState, useCallback } from 'react'
import { StyleSheet, View, Text } from 'react-native'
import { type NativeStackScreenProps } from '@react-navigation/native-stack'
import { type SwitchIndexerStackParamList } from '../stacks/types'
import { palette } from '../styles/colors'
import { Button } from '../components/Button'
import { SettingsScrollLayout } from '../components/SettingsLayout'
import { RecoveryPhraseInput } from '../components/RecoveryPhraseInput'
import { useRecoveryPhraseValidation } from '../hooks/useRecoveryPhraseValidation'
import { useRecoveryPhraseRegistration } from '../hooks/useRecoveryPhraseRegistration'

type Props = NativeStackScreenProps<
  SwitchIndexerStackParamList,
  'SwitchRecoveryPhrase'
>

export function SwitchRecoveryPhraseScreen({ navigation, route }: Props) {
  const { indexerURL } = route.params
  const [manualPhrase, setManualPhrase] = useState('')

  const { normalizedManualPhrase, isManualPhraseValid, manualValidationError } =
    useRecoveryPhraseValidation(manualPhrase)

  const { register, isSubmitting } = useRecoveryPhraseRegistration()

  const handleContinue = useCallback(async () => {
    const { success } = await register(normalizedManualPhrase, indexerURL)
    if (success) {
      navigation.navigate('SwitchFinished', { indexerURL })
    }
  }, [register, normalizedManualPhrase, indexerURL, navigation])

  return (
    <SettingsScrollLayout style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.subtitle}>
          Enter your recovery phrase to connect to the new indexer. This must be
          the same phrase you used when you first set up the app.
        </Text>

        <RecoveryPhraseInput
          value={manualPhrase}
          onChangeText={setManualPhrase}
          isValid={isManualPhraseValid}
          normalizedValue={normalizedManualPhrase}
          validationError={manualValidationError}
          editable={!isSubmitting}
        />

        <Button
          onPress={handleContinue}
          disabled={!isManualPhraseValid || isSubmitting}
        >
          {isSubmitting ? 'Connecting...' : 'Continue'}
        </Button>
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
    paddingVertical: 24,
  },
  subtitle: {
    color: palette.gray[300],
    fontSize: 14,
    lineHeight: 20,
  },
})
