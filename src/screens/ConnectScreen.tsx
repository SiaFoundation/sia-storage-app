import { Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useSettings } from '../lib/settingsContext'

export default function ConnectScreen() {
  const { doAuthentication } = useSettings()

  return (
    <SafeAreaView>
      <View style={styles.container}>
        <View style={styles.row}>
          <Image
            style={styles.image}
            source={require('../../assets/icon.png')}
          />
          <Text style={styles.heading}>Sia Mobile</Text>
        </View>
        <Pressable
          style={styles.button}
          onPress={async () => {
            doAuthentication()
          }}
        >
          <Text style={styles.buttonText}>Authorize connection</Text>
        </Pressable>
      </View>
    </SafeAreaView>
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
  heading: { color: '#24292f', fontSize: 32, fontWeight: '600' },
  button: {
    backgroundColor: '#0969da',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  buttonText: { color: '#ffffff', fontWeight: '700' },
  input: {
    backgroundColor: 'white',
    width: '80%',
    height: 25,
    borderRadius: 4,
    padding: 5,
  },
  image: {
    width: 50,
    height: 50,
  },
  row: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
  },
})
