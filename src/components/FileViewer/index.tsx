import { StyleSheet, Text, TouchableHighlight, View } from 'react-native'
import { useFileStatus } from '../../lib/file'
import { CloudDownloadIcon, FileIcon } from 'lucide-react-native'
import { ImageViewer } from '../MediaConsumers/ImageViewer'
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
import { LocalObjectsMap } from '../../encoding/localObject'

export function FileViewer({
  file,
  header,
  fullscreen = true,
  customDownloader,
}: {
  file: {
    id: string
    fileName: string | null
    fileType: string | null
    fileSize: number | null
    localId: string | null
    objects: LocalObjectsMap | null
  }
  header?: React.ReactNode
  fullscreen?: boolean
  customDownloader?: () => void
}) {
  const { fileType, fileName } = file
  const status = useFileStatus(file)
  const { cachedUri, isDownloaded, isDownloading } = status
  const fileDownload = useDownload(file)
  const fileDownloadState = useDownloadState(file.id)

  const onDownloadPress = useCallback(() => {
    if (isDownloading) return
    if (customDownloader) customDownloader()
    else fileDownload()
  }, [isDownloading, customDownloader, fileDownload])

  const lowerCasedFileName = useMemo(
    () => fileName?.toLowerCase() ?? '',
    [fileName]
  )

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
    if (!isDownloaded || !cachedUri) return DownloadPanel

    if (fileType?.includes('image')) {
      return (
        <ImageViewer
          uri={cachedUri}
          style={fullscreen ? styles.mediaWithPadding : styles.media}
        />
      )
    }
    if (fileType?.includes('video')) {
      return (
        <VideoPlayer
          source={cachedUri}
          style={fullscreen ? styles.mediaWithPadding : styles.media}
        />
      )
    }
    if (fileType?.includes('audio')) {
      return (
        <AudioPlayer
          source={cachedUri}
          filename={fileName}
          style={fullscreen ? styles.mediaWithPadding : styles.media}
        />
      )
    }
    if (fileType?.includes('pdf') || lowerCasedFileName.endsWith('.pdf')) {
      return <PDFViewer source={cachedUri} style={styles.media} />
    }
    if (
      fileType?.includes('application/json') ||
      lowerCasedFileName.endsWith('.json')
    ) {
      return (
        <JSONViewer
          uri={cachedUri}
          fileSize={file.fileSize}
          style={styles.media}
        />
      )
    }
    if (
      fileType?.includes('text/markdown') ||
      lowerCasedFileName.endsWith('.md') ||
      lowerCasedFileName.endsWith('.markdown')
    ) {
      return <MarkdownViewer uri={cachedUri} style={styles.media} />
    }
    if (
      fileType?.includes('text/plain') ||
      lowerCasedFileName.endsWith('.txt')
    ) {
      return (
        <TextViewer
          uri={cachedUri}
          fileSize={file.fileSize}
          style={styles.media}
        />
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
    cachedUri,
    isDownloaded,
    fileType,
    lowerCasedFileName,
    fullscreen,
    fileName,
    file.fileSize,
    DownloadPanel,
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
