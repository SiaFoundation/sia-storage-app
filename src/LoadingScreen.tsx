import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native'

export default function LoadingScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Storage App</Text>
      <ActivityIndicator />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    height: '100%',
    width: '100%',
    backgroundColor: '#517891',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 30,
  },
  text: {
    color: '#cbd5e1',
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
    fontSize: 32,
  },
})
