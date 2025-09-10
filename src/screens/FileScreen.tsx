import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import FileItem from '../components/FileItem'
import { useFileRecordActions, useFileRecords } from '../hooks/swrHooks'

export default function FileScreen() {
  const { data: fileRecords, isLoading } = useFileRecords()
  const { deleteAll, seedDB } = useFileRecordActions()

  return (
    <View style={styles.container}>
      <Text style={styles.text}>File (Slab?) View</Text>
      <ScrollView style={styles.fileContainer}>
        {isLoading && <Text>Loading...</Text>}
        {fileRecords?.length ? (
          fileRecords.map((record) => <FileItem key={record.id} {...record} />)
        ) : (
          <Text>Nothing here</Text>
        )}
      </ScrollView>
      <Pressable
        style={styles.button}
        onPress={async () => {
          await seedDB()
        }}
      >
        <Text>Seed DB</Text>
      </Pressable>
      <Pressable
        style={styles.button}
        onPress={async () => {
          await deleteAll()
        }}
      >
        <Text>Clear DB</Text>
      </Pressable>
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
  button: {
    width: '100%',
    backgroundColor: '#90D5FF',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
})
