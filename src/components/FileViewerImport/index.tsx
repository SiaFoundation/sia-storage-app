import { View, StyleSheet, Pressable } from 'react-native'
import { colors } from '../../styles/colors'
import { ArrowDownToLineIcon } from 'lucide-react-native'
import { useFileStatus } from '../../lib/file'
import ImageViewer from './ImageViewer'
import { VideoViewer } from './VideoViewer'
import { CircularProgress } from '../CircularProgress'
import { useDownloadFromShareURL } from '../../managers/downloader'
import { useEffect } from 'react'
import {
  detailsShouldAutoDownload,
  useAutoDownloadFromShareURL,
} from '../../hooks/useAutoDownload'

export function FileViewerImport({
  file,
  shareUrl,
}: {
  file: {
    id: string
    fileType: string | null
    fileSize: number | null
  }
  shareUrl: string
}) {
  const status = useFileStatus(file)
  const handleDownload = useDownloadFromShareURL()

  const isVideo = file.fileType?.startsWith('video')

  useAutoDownloadFromShareURL(file, detailsShouldAutoDownload, shareUrl)
  useEffect(() => {
    if (!status.isDownloaded) {
      handleDownload(file.id, shareUrl)
    }
  }, [file.id, shareUrl])

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
          <ArrowDownToLineIcon color={colors.accentPrimary} size={28} />
        </Pressable>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    backgroundColor: colors.bgPanel,
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
