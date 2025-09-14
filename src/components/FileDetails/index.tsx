import { View, StyleSheet, ScrollView } from 'react-native'
import { type FileRecord } from '../../stores/files'
import { useFileStatus } from '../../lib/file'
import { FileMap } from './FileMap'
import { FileViewer } from '../FileViewer'
import { FileMeta } from './FileMeta'

export function FileDetails({ file }: { file: FileRecord }) {
  const status = useFileStatus(file)
  return (
    <View style={styles.container}>
      <ScrollView>
        <FileViewer file={file} />
        <FileMeta file={file} status={status} />
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f2f2f7',
  },
  centerDownload: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
})
