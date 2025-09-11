import { View, StyleSheet, Pressable } from 'react-native'
import { ArrowDownToLineIcon } from 'lucide-react-native'
import { CircularProgress } from '../CircularProgress'
import VideoViewer from './VideoViewer'
import { type FileRecord } from '../../db/files'
import { useFileStatus } from '../../lib/file'
import { FileIndicators } from '../FileIndicators'
import ImageViewer from './ImageViewer'

export function FileViewer({
  file,
  onDownload,
}: {
  file: FileRecord
  onDownload?: () => void
}) {
  const status = useFileStatus(file)

  console.log(JSON.stringify(file, null, 2), JSON.stringify(status, null, 2))

  return (
    <View style={[styles.container]}>
      <View style={styles.asset}>
        {file.fileType?.startsWith('image') ? (
          <ImageViewer uri={status.cachedUri!} status={status} />
        ) : (
          <VideoViewer uri={status.cachedUri!} status={status} />
        )}
      </View>
      <FileIndicators file={file} />
      {file.fileType?.startsWith('video') && status.isDownloading ? (
        <View style={styles.centerDownload} pointerEvents="none">
          <CircularProgress progress={status.downloadProgress} size={44} />
        </View>
      ) : file.fileType?.startsWith('video') &&
        !status.cachedUri &&
        onDownload ? (
        <Pressable
          accessibilityRole="button"
          onPress={onDownload}
          style={styles.centerDownload}
        >
          <ArrowDownToLineIcon color="#0969da" size={28} />
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    backgroundColor: '#ffffff',
  },
  asset: { width: '100%', height: '100%' },
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
