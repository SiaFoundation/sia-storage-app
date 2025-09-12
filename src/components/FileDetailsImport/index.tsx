import { View, StyleSheet, ScrollView } from 'react-native'
import { type FileRecord } from '../../db/files'
import { useFileStatus } from '../../lib/file'
import { FileViewerImport } from '../FileViewerImport'
import { FileMetaImport } from './FileMetaImport'

export function FileDetailsImport({
  file,
  shareUrl,
}: {
  file: {
    id: string
    fileName: string | null
    fileSize: number | null
    createdAt: number
    fileType: string | null
    pinnedObjects: unknown
  }
  shareUrl: string
}) {
  const status = useFileStatus(file)
  return (
    <View style={styles.container}>
      <ScrollView>
        <FileViewerImport file={file} shareUrl={shareUrl} />
        <FileMetaImport file={file} status={status} />
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
