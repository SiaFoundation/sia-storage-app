import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useSettings } from '../lib/settingsContext'

export default function ConnectScreen() {
  const { doAuthentication } = useSettings()

  return (
    <SafeAreaView>
      <View style={styles.container}>
        <Text style={styles.header}>Storage App</Text>
        <Text style={styles.text}>Please auth TK TK</Text>
        <Pressable
          style={styles.button}
          onPress={async () => {
            doAuthentication()
          }}
        >
          <Text>Authorize</Text>
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
