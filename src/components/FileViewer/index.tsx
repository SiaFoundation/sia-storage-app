import { CloudDownloadIcon, FileIcon } from 'lucide-react-native'
import { useCallback, useMemo } from 'react'
import { StyleSheet, Text, TouchableHighlight, View } from 'react-native'
import { useFileStatus } from '../../lib/file'
import { humanSize } from '../../lib/humanSize'
import { useDownload } from '../../managers/downloader'
import { useDownloadState } from '../../stores/downloads'
import type { FileRecord } from '../../stores/files'
import { colors } from '../../styles/colors'
import { AudioPlayer } from '../MediaConsumers/AudioPlayer'
import { ImageViewer } from '../MediaConsumers/ImageViewer'
import { JSONViewer } from '../MediaConsumers/JSONViewer'
import { MarkdownViewer } from '../MediaConsumers/MarkdownViewer'
import { PDFViewer } from '../MediaConsumers/PDFViewer'
import { TextViewer } from '../MediaConsumers/TextViewer'
import { VideoPlayer } from '../MediaConsumers/VideoPlayer'

type FileViewerProps = {
  file: FileRecord
  isShared?: boolean
  customDownloader?: () => void
  textTopInset?: number
  onViewerControlPress?: () => void
  onImageZoomChange?: (isZoomed: boolean) => void
  onSwipeLeft?: () => void
  onSwipeRight?: () => void
}

export function FileViewer({
  file,
  isShared,
  customDownloader,
  textTopInset,
  onViewerControlPress,
  onImageZoomChange,
  onSwipeLeft,
  onSwipeRight,
}: FileViewerProps) {
  const { type, name } = file
  const status = useFileStatus(file, isShared)
  const { fileUri, isDownloaded, isDownloading } = status.data ?? {}
  const fileDownload = useDownload(file)
  const fileDownloadState = useDownloadState(file.id)

  const baseMediaStyle = styles.media
  const textMediaStyle = textTopInset
    ? StyleSheet.flatten([baseMediaStyle, { paddingTop: textTopInset }])
    : baseMediaStyle
  const textInsetValue =
    textTopInset && textTopInset > 0 ? textTopInset : undefined

  const onDownloadPress = useCallback(() => {
    if (onViewerControlPress) onViewerControlPress()
    if (isDownloading) return
    if (customDownloader) customDownloader()
    else fileDownload()
  }, [isDownloading, customDownloader, fileDownload, onViewerControlPress])

  const lowerCasedFileName = useMemo(() => name?.toLowerCase() ?? '', [name])

  const isQueued = fileDownloadState?.status === 'queued'

  const DownloadPanel = useMemo(() => {
    return (
      <View
        style={[
          baseMediaStyle,
          { justifyContent: 'center', alignItems: 'center', gap: 20 },
        ]}
      >
        <TouchableHighlight onPress={onDownloadPress} disabled={isQueued}>
          <CloudDownloadIcon color={colors.textPrimary} size={40} />
        </TouchableHighlight>

        {!isDownloading && !isQueued ? (
          <Text style={{ color: colors.textPrimary }}>
            Press to download ({humanSize(file.size)})
          </Text>
        ) : null}

        {isQueued ? (
          <Text style={{ color: colors.textPrimary }}>Download queued</Text>
        ) : null}

        {isDownloading && !isQueued ? (
          <Text style={{ color: colors.textPrimary }}>
            Downloading: {((fileDownloadState?.progress || 0) * 100).toFixed(0)}
            %
          </Text>
        ) : null}
      </View>
    )
  }, [
    isDownloading,
    isQueued,
    onDownloadPress,
    fileDownloadState?.progress,
    file.size,
  ])

  const mediaContent = useMemo(() => {
    if (!isDownloaded || !fileUri) return DownloadPanel

    if (type?.includes('image'))
      return (
        <ImageViewer
          uri={fileUri}
          style={baseMediaStyle}
          onZoomChange={onImageZoomChange}
        />
      )
    if (type?.includes('video'))
      return (
        <VideoPlayer
          source={fileUri}
          style={baseMediaStyle}
          onViewerControlPress={onViewerControlPress}
        />
      )
    if (type?.includes('audio')) {
      return (
        <AudioPlayer
          source={fileUri}
          filename={name}
          style={baseMediaStyle}
          onViewerControlPress={onViewerControlPress}
        />
      )
    }
    if (type?.includes('pdf') || lowerCasedFileName.endsWith('.pdf')) {
      return (
        <PDFViewer
          source={fileUri}
          style={baseMediaStyle}
          onSwipeLeft={onSwipeLeft}
          onSwipeRight={onSwipeRight}
        />
      )
    }

    if (
      type?.includes('application/json') ||
      lowerCasedFileName.endsWith('.json')
    ) {
      return (
        <JSONViewer
          uri={fileUri}
          fileSize={file.size}
          style={baseMediaStyle}
          topInset={textInsetValue}
        />
      )
    }
    if (
      type?.includes('text/markdown') ||
      lowerCasedFileName.endsWith('.md') ||
      lowerCasedFileName.endsWith('.markdown')
    ) {
      return (
        <MarkdownViewer
          uri={fileUri}
          style={textMediaStyle}
          onViewerControlPress={onViewerControlPress}
        />
      )
    }
    if (type?.includes('text/plain') || lowerCasedFileName.endsWith('.txt')) {
      return (
        <TextViewer
          uri={fileUri}
          fileSize={file.size}
          style={baseMediaStyle}
          topInset={textInsetValue}
        />
      )
    }

    return (
      <View
        style={[
          baseMediaStyle,
          { justifyContent: 'center', alignItems: 'center', gap: 20 },
        ]}
      >
        <FileIcon color={colors.textPrimary} size={40} />
        <Text style={{ color: colors.textPrimary }}>Preview not supported</Text>
      </View>
    )
  }, [
    DownloadPanel,
    fileUri,
    isDownloaded,
    lowerCasedFileName,
    name,
    textInsetValue,
    textMediaStyle,
    type,
    file.size,
    onViewerControlPress,
    onSwipeLeft,
    onSwipeRight,
    onImageZoomChange,
  ])

  return <View style={styles.container}>{mediaContent}</View>
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'column' },
  media: { flex: 1 },
})
