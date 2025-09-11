import { View, StyleSheet, Pressable } from 'react-native'
import { ArrowDownToLineIcon } from 'lucide-react-native'
import { type FileRecord } from '../../db/files'
import { useFileStatus } from '../../lib/file'
import { FileIndicators } from '../FileIndicators'
import ImageViewer from './ImageViewer'
import { useDownload } from '../../lib/downloadManager'
import { VideoViewer } from './VideoViewer'
import { CircularProgress } from '../CircularProgress'

export function FileViewer({ file }: { file: FileRecord }) {
  const status = useFileStatus(file)
  const handleDownload = useDownload(file)

  const isVideo = file.fileType?.startsWith('video')

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
          onPress={() => handleDownload(false)}
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
