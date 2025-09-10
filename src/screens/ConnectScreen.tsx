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

export default function ConnectScreen() {
  const [isUsingCustomURL, setIsUsingCustomURL] = useState(false)
  const { authIndexer, indexerURL, setIndexerURL } = useSettings()

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
        <Text style={styles.text}>
          Authorize the indexer. Click the gear to supply your own.
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
            authIndexer()
          }}
        >
          <Text style={styles.buttonText}>Authorize connection</Text>
        </Pressable>
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
    alignItems: 'center',
    gap: 20,

    paddingTop: 150,
  },
  text: {
    color: '#24292f',
    fontSize: 16,
    marginHorizontal: 60,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#0969da',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  buttonText: { color: '#ffffff', fontWeight: '700' },
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
    paddingVertical: 7,
    paddingHorizontal: 30,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 3,
  },
})
