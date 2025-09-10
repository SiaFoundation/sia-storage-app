import { useState } from 'react'
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import authApp from '../functions/authApp'
import { useSettings } from '../lib/settingsContext'

type Props = {
  bypassAuth: () => void
}

export default function ConnectScreen({ bypassAuth }: Props) {
  const { setIsOnboarding } = useSettings()
  const [indexDServer, setIndexDServer] = useState(
    'https://app.indexd.zeus.sia.dev/auth/connect/979f2461e24bf04ffc549b033791e609'
  )

  return (
    <SafeAreaView>
      <View style={styles.container}>
        <Text style={styles.header}>Storage App</Text>
        <Text style={styles.text}>Connect to provider</Text>
        <TextInput
          style={styles.input}
          value={indexDServer}
          onChangeText={(text) => setIndexDServer(text)}
        />
        <Pressable
          style={styles.button}
          onPress={async () => {
            // This blocks the app
            await authApp(indexDServer)
            setIsOnboarding(true)
          }}
        >
          <Text>Authorize</Text>
        </Pressable>
        <Pressable style={styles.button} onPress={() => bypassAuth()}>
          <Text>Dev Bypass</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#517891',
    height: '100%',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 15,

    paddingTop: 100,
  },
  text: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
    fontSize: 18,
    color: '#cbd5e1',
  },
  header: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
    fontSize: 36,
    color: '#cbd5e1',
  },
  button: {
    backgroundColor: '#90D5FF',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
    width: '80%',
  },
  input: {
    backgroundColor: 'white',
    width: '80%',
    height: 25,
    borderRadius: 4,
    padding: 5,
  },
})
