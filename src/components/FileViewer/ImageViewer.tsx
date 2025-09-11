import { ArrowDownToLineIcon } from 'lucide-react-native'
import { StyleSheet, Image, View, Pressable } from 'react-native'
import { CircularProgress } from '../CircularProgress'
import { FileStatus } from '../../lib/file'

export default function ImageViewer({
  uri,
  status,
  onDownload,
}: {
  uri: string
  status: FileStatus
  onDownload?: () => void
}) {
  console.log('ImageViewer', uri, status)
  return (
    <View>
      {status.isDownloading ? (
        <View style={styles.centerDownload} pointerEvents="none">
          <CircularProgress progress={status.downloadProgress ?? 0} size={44} />
        </View>
      ) : status.isDownloading && !uri && onDownload ? (
        <Pressable
          accessibilityRole="button"
          onPress={onDownload}
          style={styles.centerDownload}
        >
          <ArrowDownToLineIcon color="#0969da" size={28} />
        </Pressable>
      ) : null}
      <Image source={{ uri: uri }} style={styles.image} resizeMode="cover" />
    </View>
  )
}

const styles = StyleSheet.create({
  image: { width: '100%', height: '100%' },
  centerDownload: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
