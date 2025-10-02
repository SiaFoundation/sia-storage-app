import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SettingsIcon } from 'lucide-react-native'
import { useState } from 'react'
import { useToast } from '../lib/toastContext'
import { InputRow } from '../components/InputRow'
import { InfoCard } from '../components/InfoCard'
import { Button } from '../components/Button'
import { setRecoveryPhrase, useRecoveryPhrase } from '../stores/settings'
import { useChangeIndexer } from '../hooks/useChangeIndexer'
import { useControlledInputValue } from '../hooks/useInputValue'
import { generateRecoveryPhrase } from 'react-native-sia'
import { useCopyRecoveryPhrase } from '../hooks/useCopyRecoveryPhrase'
import { InputArea } from '../components/InputArea'

export default function OnboardingScreen() {
  const [isUsingCustomURL, setIsUsingCustomURL] = useState(false)
  const recoveryPhrase = useRecoveryPhrase()
  const toast = useToast()
  const copyRecoveryPhrase = useCopyRecoveryPhrase()

  const { newIndexerInputProps, saveIndexerURL, isWaiting, hasErrored } =
    useChangeIndexer()

  const newRecoveryPhraseInputProps = useControlledInputValue({
    value: recoveryPhrase.data ?? '',
    save: (text) => {
      try {
        setRecoveryPhrase(text)
      } catch {
        toast.show('Invalid seed')
      }
    },
  })

  return (
    <View>
      <View style={styles.header}>
        <Image
          style={styles.image}
          source={require('../../assets/icon-bleed.png')}
        />
        <Pressable onPress={() => setIsUsingCustomURL((current) => !current)}>
          <SettingsIcon size={20} color="gray" />
        </Pressable>
      </View>
      {isWaiting ? (
        <View style={styles.center}>
          <ActivityIndicator color="#0ea5e9" />
          <Text style={styles.waitingText}>connecting</Text>
        </View>
      ) : (
        <View style={styles.container}>
          <Text style={styles.title}>Welcome to Sia Mobile!</Text>
          <Text style={styles.text}>
            To begin using the app, press below and authorize the indexer. A
            password should have been provided to you by the indexer admin. To
            use your own indexer, press the gear in the upper right and enter
            the base URL.
          </Text>
          <View style={{ gap: 8 }}>
            <Text style={styles.errorText}>
              {hasErrored
                ? 'Something went wrong. Please check your password and try again.'
                : null}
            </Text>
            {isUsingCustomURL ? (
              <>
                <InfoCard>
                  <InputRow label="Indexer URL" {...newIndexerInputProps} />
                </InfoCard>
                <InfoCard>
                  <InputArea
                    label="Recovery phrase"
                    {...newRecoveryPhraseInputProps}
                    isMonospace
                  />
                </InfoCard>
                <View style={styles.actions}>
                  <Button
                    variant="secondary"
                    onPress={async () => {
                      await setRecoveryPhrase(generateRecoveryPhrase())
                      toast.show('Recovery phrase regenerated')
                    }}
                    style={styles.button}
                  >
                    Regenerate phrase
                  </Button>
                  <Button
                    variant="secondary"
                    onPress={copyRecoveryPhrase}
                    style={styles.button}
                  >
                    Copy phrase
                  </Button>
                </View>
              </>
            ) : null}
            <Button onPress={saveIndexerURL}>Authorize & Connect</Button>
          </View>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    height: '100%',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    paddingHorizontal: 16,
    paddingTop: 100,
  },
  text: {
    color: '#24292f',
    fontSize: 16,
  },
  errorText: {
    color: 'red',
    fontSize: 10,
  },
  waitingText: {
    color: '#57606a',
    fontSize: 12,
  },
  image: {
    width: 15,
    height: 15,
  },
  actions: { flexDirection: 'row', gap: 8, width: '100%' },
  header: {
    height: 44,
    paddingHorizontal: 16,
    borderBottomColor: '#d0d7de',
    borderBottomWidth: StyleSheet.hairlineWidth,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  input: {
    backgroundColor: 'white',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 3,
  },
  title: { color: '#24292f', fontSize: 24, fontWeight: '600' },
  center: {
    alignItems: 'center',
    height: '100%',
    paddingTop: 250,
    gap: 16,
  },
  button: { flex: 1 },
})
