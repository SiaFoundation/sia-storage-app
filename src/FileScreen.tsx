import { Platform, StyleSheet, Text, View } from 'react-native'
import FileItem from './components/FileItem'

export default function FileScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>File (Slab?) View</Text>
      <View style={styles.fileContainer}>
        <FileItem id="1" length={2} offset={3} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#517891',
    height: '100%',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: 15,

    paddingHorizontal: 20,
  },
  text: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
    fontSize: 18,
    color: '#cbd5e1',
  },
  fileContainer: {
    backgroundColor: 'white',
    width: '100%',
    borderRadius: 5,

    display: 'flex',
    flexDirection: 'column',
    gap: 15,
    flexGrow: 1,
  },
})
