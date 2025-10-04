import { View, StyleSheet, ScrollView } from 'react-native'
import { colors } from '../../styles/colors'
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
    fileType: string | null
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
    backgroundColor: colors.bgCanvas,
  },
})
