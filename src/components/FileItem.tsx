import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import shareLink from '../functions/shareLink'
import { type FileRecord } from '../db/files'

export default function FileItem({
  id,
  fileName,
  fileSize,
  status,
}: FileRecord) {
  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <Text>name: {fileName ?? 'untitled'}</Text>
        <Text>id: {id}</Text>
        <Text>status: {status}</Text>
      </View>
      <View style={styles.row}>
        <Text>size: {fileSize ?? 0}</Text>
        <Pressable style={styles.button}>
          <Text
            style={styles.buttonText}
            onPress={() => shareLink({ url: 'google.com' })}
          >
            Share
          </Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    display: 'flex',
    gap: 4,

    padding: 10,

    borderColor: 'lightgray',
    borderStyle: 'solid',
    borderBottomWidth: 1,
  },
  row: {
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  button: {
    backgroundColor: '#517891',
    padding: 5,
    borderRadius: 5,
  },
  buttonText: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
    fontSize: 12,
    color: '#cbd5e1',
  },
})
