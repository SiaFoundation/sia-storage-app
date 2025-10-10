import { View, StyleSheet, Pressable, Text } from 'react-native'
import { colors, palette } from '../../styles/colors'
import { ArrowDownToLineIcon, XIcon } from 'lucide-react-native'
import { useFileStatus } from '../../lib/file'
import { FileIndicators } from '../FileIndicators'
import ImageViewer from './ImageViewer'
import { useDownload } from '../../managers/downloader'
import { VideoViewer } from './VideoViewer'
import { CircularProgress } from '../CircularProgress'
import { SealedObject } from 'react-native-sia'
import {
  detailsShouldAutoDownload,
  useAutoDownload,
} from '../../hooks/useAutoDownload'

export function FileViewer({
  file,
}: {
  file: {
    id: string
    fileType: string | null
    sealedObjects: Record<string, SealedObject> | null
    fileSize: number | null
  }
}) {
  const status = useFileStatus(file)
  const handleDownload = useDownload(file)

  const isVideo = file.fileType?.startsWith('video')

  useAutoDownload(file, detailsShouldAutoDownload)

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
      <FileIndicators file={file} interactive />
      {status.fileIsGone ? (
        <View style={styles.centerDownload}>
          <XIcon color="red" size={28} />
          <Text style={styles.centerDownloadText}>File is gone</Text>
        </View>
      ) : status.isDownloading ? (
        <View style={styles.centerDownload}>
          <CircularProgress progress={status.downloadProgress ?? 0} size={44} />
        </View>
      ) : status.cachedUri ? null : (
        <Pressable
          accessibilityRole="button"
          disabled={status.isDownloading}
          onPress={() => handleDownload()}
          style={styles.centerDownload}
        >
          <ArrowDownToLineIcon color={colors.accentPrimary} size={28} />
        </Pressable>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { width: '100%', backgroundColor: colors.bgCanvas, paddingTop: 0 },
  asset: {},
  centerDownload: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    zIndex: 2,
  },
  centerDownloadText: {
    color: palette.red[500],
    fontSize: 16,
  },
})
