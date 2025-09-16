import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import {
  useIndexerURL,
  setIndexerURL,
  tryToConnectAndSet,
} from '../stores/auth'
import { SettingsIcon } from 'lucide-react-native'
import { useState } from 'react'
import { useToast } from '../lib/toastContext'
import { InputRow } from '../components/InputRow'
import { InfoCard } from '../components/InfoCard'

function validateURL(url: string) {
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

export default function OnboardingScreen() {
  const [isUsingCustomURL, setIsUsingCustomURL] = useState(false)
  const [isWaiting, setIsWaiting] = useState(false)
  const [hasErrored, setHasErrored] = useState(false)
  const indexerURL = useIndexerURL()
  const toast = useToast()

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
              <InfoCard>
                <InputRow
                  label="Indexer URL"
                  value={indexerURL}
                  onChangeText={setIndexerURL}
                />
              </InfoCard>
            ) : null}
            <Pressable
              style={styles.button}
              onPress={async () => {
                setIsWaiting(true)
                const isValid = validateURL(indexerURL)
                if (!isValid) {
                  toast.show('Invalid URL')
                  setIsWaiting(false)
                  return
                }
                const success = await tryToConnectAndSet(indexerURL)
                if (!success) {
                  toast.show('Failed to connect')
                  setHasErrored(true)
                }
                setIsWaiting(false)
              }}
            >
              <Text style={styles.buttonText}>Authorize & Connect</Text>
            </Pressable>
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
  button: {
    width: '100%',
    backgroundColor: '#0969da',
    borderRadius: 8,
    paddingVertical: 12,
  },
  buttonText: { color: '#ffffff', fontWeight: '700', textAlign: 'center' },
  image: {
    width: 15,
    height: 15,
  },
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
})
