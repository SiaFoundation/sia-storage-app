import { StyleSheet, Text, TouchableHighlight, View } from 'react-native'
import { useFileStatus } from '../../lib/file'
import { CloudDownloadIcon, FileIcon } from 'lucide-react-native'
import {
  ImageViewer,
  type ImageViewerHandle,
} from '../MediaConsumers/ImageViewer'
import { VideoPlayer } from '../MediaConsumers/VideoPlayer'
import { AudioPlayer } from '../MediaConsumers/AudioPlayer'
import { PDFViewer } from '../MediaConsumers/PDFViewer'
import { TextViewer } from '../MediaConsumers/TextViewer'
import { MarkdownViewer } from '../MediaConsumers/MarkdownViewer'
import { JSONViewer } from '../MediaConsumers/JSONViewer'
import { useDownload } from '../../managers/downloader'
import { useDownloadState } from '../../stores/downloads'
import { colors } from '../../styles/colors'
import { useCallback, useMemo } from 'react'
import type { Ref } from 'react'
import { FileRecord } from '../../stores/files'
import {
  useAutoDownload,
  detailsShouldAutoDownload,
} from '../../hooks/useAutoDownload'

export function FileViewer({
  file,
  isShared,
  header,
  fullscreen = true,
  customDownloader,
  imageViewerRef,
}: {
  file: FileRecord
  isShared?: boolean
  header?: React.ReactNode
  fullscreen?: boolean
  customDownloader?: () => void
  imageViewerRef?: Ref<ImageViewerHandle>
}) {
  const { type, name } = file
  const status = useFileStatus(file, isShared)
  const { fileUri, isDownloaded, isDownloading } = status.data ?? {}
  useAutoDownload(file, detailsShouldAutoDownload)
  const fileDownload = useDownload(file)
  const fileDownloadState = useDownloadState(file.id)

  const onDownloadPress = useCallback(() => {
    if (isDownloading) return
    if (customDownloader) customDownloader()
    else fileDownload()
  }, [isDownloading, customDownloader, fileDownload])

  const lowerCasedFileName = useMemo(() => name?.toLowerCase() ?? '', [name])

  const DownloadPanel = useMemo(() => {
    return (
      <View
        style={[
          fullscreen ? styles.mediaWithPadding : styles.media,
          { justifyContent: 'center', alignItems: 'center', gap: 20 },
        ]}
      >
        <TouchableHighlight onPress={onDownloadPress}>
          <CloudDownloadIcon color={colors.textPrimary} size={40} />
        </TouchableHighlight>

        {!isDownloading ? (
          <Text style={{ color: colors.textPrimary }}>Press to download</Text>
        ) : null}

        {isDownloading ? (
          <Text style={{ color: colors.textPrimary }}>
            Downloading: {((fileDownloadState?.progress || 0) * 100).toFixed(0)}
            %
          </Text>
        ) : null}
      </View>
    )
  }, [fullscreen, onDownloadPress, isDownloading, fileDownloadState?.progress])

  const MediaDisplayElement = useMemo(() => {
    if (!isDownloaded || !fileUri) return DownloadPanel

    if (type?.includes('image')) {
      return (
        <ImageViewer
          ref={imageViewerRef}
          uri={fileUri}
          style={fullscreen ? styles.mediaWithPadding : styles.media}
        />
      )
    }
    if (type?.includes('video')) {
      return (
        <VideoPlayer
          source={fileUri}
          style={fullscreen ? styles.mediaWithPadding : styles.media}
        />
      )
    }
    if (type?.includes('audio')) {
      return (
        <AudioPlayer
          source={fileUri}
          filename={name}
          style={fullscreen ? styles.mediaWithPadding : styles.media}
        />
      )
    }
    if (type?.includes('pdf') || lowerCasedFileName.endsWith('.pdf')) {
      return <PDFViewer source={fileUri} style={styles.media} />
    }
    if (
      type?.includes('application/json') ||
      lowerCasedFileName.endsWith('.json')
    ) {
      return (
        <JSONViewer uri={fileUri} fileSize={file.size} style={styles.media} />
      )
    }
    if (
      type?.includes('text/markdown') ||
      lowerCasedFileName.endsWith('.md') ||
      lowerCasedFileName.endsWith('.markdown')
    ) {
      return <MarkdownViewer uri={fileUri} style={styles.media} />
    }
    if (type?.includes('text/plain') || lowerCasedFileName.endsWith('.txt')) {
      return (
        <TextViewer uri={fileUri} fileSize={file.size} style={styles.media} />
      )
    }

    return (
      <View
        style={[
          fullscreen ? styles.mediaWithPadding : styles.media,
          { justifyContent: 'center', alignItems: 'center', gap: 20 },
        ]}
      >
        <FileIcon color={colors.textPrimary} size={40} />
        <Text style={{ color: colors.textPrimary }}>Preview not supported</Text>
      </View>
    )
  }, [
    fileUri,
    isDownloaded,
    type,
    lowerCasedFileName,
    fullscreen,
    name,
    file.size,
    DownloadPanel,
    imageViewerRef,
  ])

  return (
    <View style={styles.container}>
      {header}
      {MediaDisplayElement}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'column' },
  mediaWithPadding: { flex: 1, marginBottom: 120 },
  media: { flex: 1 },
})
