import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useSettings } from '../lib/settingsContext'
import { SettingsIcon } from 'lucide-react-native'
import { useState } from 'react'

export default function OnboardingScreen() {
  const [isUsingCustomURL, setIsUsingCustomURL] = useState(false)
  const [hasErrored, setHasErrored] = useState(false)
  const { authIndexer, indexerURL, setIndexerURL, setIsOnboarding } =
    useSettings()

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
      <View style={styles.container}>
        <Text style={styles.title}>Welcome!</Text>
        <Text style={styles.text}>
          To begin using the app, press below to begin indexer authorization. To
          use your own indexer, press the gear in the upper right.
        </Text>
        {isUsingCustomURL ? (
          <TextInput
            style={styles.input}
            value={indexerURL}
            onChangeText={setIndexerURL}
          />
        ) : null}
        <Pressable
          style={styles.button}
          onPress={async () => {
            const success = await authIndexer()
            if (!success) {
              setHasErrored(true)
              return
            }
            setIsOnboarding(false)
          }}
        >
          <Text style={styles.buttonText}>Authorize Indexer</Text>
        </Pressable>
        {hasErrored ? (
          <Text style={[styles.text, { fontSize: 12, color: 'red' }]}>
            Something went wrong. Please check your password and try again.
          </Text>
        ) : null}
      </View>
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

    paddingTop: 40,
  },
  text: {
    color: '#24292f',
    fontSize: 16,
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
  title: { color: '#24292f', fontSize: 16, fontWeight: '600' },
})
