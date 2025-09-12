import { View, StyleSheet, Pressable } from 'react-native'
import { ArrowDownToLineIcon } from 'lucide-react-native'
import { useFileStatus } from '../../lib/file'
import { FileIndicators } from '../FileIndicators'
import ImageViewer from './ImageViewer'
import { VideoViewer } from './VideoViewer'
import { CircularProgress } from '../CircularProgress'
import { useDownloadShared } from '../../lib/downloadShared'

export function FileViewerShared({
  file,
  shareUrl,
}: {
  file: {
    id: string
    fileType: string | null
    pinnedObjects: unknown
  }
  shareUrl: string
}) {
  const status = useFileStatus(file)
  const handleDownload = useDownloadShared()

  const isVideo = file.fileType?.startsWith('video')

  console.log('SHAReD status', JSON.stringify(status, null, 2))

  return (
    <View style={[styles.container]}>
      <View style={[styles.asset, !status.cachedUri && { height: 300 }]}>
        {status.cachedUri ? (
          isVideo ? (
            <VideoViewer status={status} />
          ) : (
            <ImageViewer status={status} />
          )
        ) : null}
      </View>
      <FileIndicators file={file} />
      {status.isDownloading ? (
        <View style={styles.centerDownload}>
          <CircularProgress progress={status.downloadProgress ?? 0} size={44} />
        </View>
      ) : status.cachedUri ? null : (
        <Pressable
          accessibilityRole="button"
          disabled={status.isDownloading}
          onPress={() => handleDownload(file.id, shareUrl)}
          style={styles.centerDownload}
        >
          <ArrowDownToLineIcon color="#0969da" size={28} />
        </Pressable>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    backgroundColor: '#ffffff',
  },
  asset: {},
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
