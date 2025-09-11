import { useMemo } from 'react'
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native'
import { ArrowDownToLineIcon } from 'lucide-react-native'
import { CircularProgress } from '../CircularProgress'
import { type FileRecord } from '../../db/files'
import { useFileStatus } from '../../lib/file'
import { FileMap } from './FileMap'
import { FileViewer } from '../FileViewer'
import { FileMeta } from './FileMeta'

export function FileDetails({
  file,
  onDownload,
}: {
  file: FileRecord
  onDownload?: () => void
}) {
  const status = useFileStatus(file)

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator
      >
        <FileViewer file={file} onDownload={onDownload} />
        <FileMeta file={file} status={status} />
        <FileMap />
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  scrollContent: { paddingBottom: 16 },
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
