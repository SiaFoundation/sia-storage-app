import { StyleSheet, Text, TouchableHighlight, View } from 'react-native'
import { useCallback, useMemo } from 'react'
import { CloudDownloadIcon, FileIcon } from 'lucide-react-native'

import { useFileStatus } from '../../lib/file'
import {
  useAutoDownload,
  detailsShouldAutoDownload,
} from '../../hooks/useAutoDownload'
import { useDownload } from '../../managers/downloader'
import { useDownloadState } from '../../stores/downloads'
import { colors } from '../../styles/colors'
import { FileRecord } from '../../stores/files'
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
}

export function FileViewer({
  file,
  isShared,
  customDownloader,
  textTopInset,
  onViewerControlPress,
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

  const DownloadPanel = useMemo(() => {
    return (
      <View
        style={[
          baseMediaStyle,
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
  }, [
    baseMediaStyle,
    isDownloading,
    onDownloadPress,
    fileDownloadState?.progress,
  ])

  const mediaContent = useMemo(() => {
    if (!isDownloaded || !fileUri) return DownloadPanel

    if (type?.includes('image'))
      return <ImageViewer uri={fileUri} style={baseMediaStyle} />
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
      return <PDFViewer source={fileUri} style={baseMediaStyle} />
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
    baseMediaStyle,
    fileUri,
    isDownloaded,
    lowerCasedFileName,
    name,
    textInsetValue,
    textMediaStyle,
    type,
    file.size,
    onViewerControlPress,
  ])

  return <View style={styles.container}>{mediaContent}</View>
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'column' },
  media: { flex: 1 },
})
