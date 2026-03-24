import { useDownloadEntry } from '@siastorage/core/stores'
import type { FileRecord } from '@siastorage/core/types'
import {
  ClockArrowUpIcon,
  ClockIcon,
  CloudDownloadIcon,
  FileIcon,
} from 'lucide-react-native'
import { useCallback, useMemo } from 'react'
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableHighlight,
  View,
} from 'react-native'
import useSWR from 'swr'
import { useFileStatus } from '../../lib/file'
import { humanSize } from '../../lib/humanSize'
import { getMediaLibraryUri } from '../../lib/mediaLibrary'
import { useDownload } from '../../managers/downloader'
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
  const {
    fileUri,
    isDownloaded,
    isDownloading,
    isProcessing,
    isDeferredImport,
  } = status.data ?? {}
  const fileDownload = useDownload(file)
  const { data: fileDownloadState } = useDownloadEntry(file.id)

  const localId = file.hash === '' && file.localId ? file.localId : null
  const mediaLibrarySwr = useSWR(
    localId ? ['mediaLibraryUri', localId] : null,
    () => getMediaLibraryUri(localId),
  )
  const mediaLibraryUri = mediaLibrarySwr.data
  const mediaLibraryLoading = localId
    ? !mediaLibrarySwr.data && !mediaLibrarySwr.error
    : false

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

  const ImportingPanel = useMemo(() => {
    return (
      <View
        style={[
          baseMediaStyle,
          {
            justifyContent: 'center',
            alignItems: 'center',
            gap: 12,
            paddingHorizontal: 32,
          },
        ]}
      >
        {isDeferredImport ? (
          <ClockIcon color={colors.textSecondary} size={40} />
        ) : (
          <ClockArrowUpIcon color={colors.textSecondary} size={40} />
        )}
        <Text
          style={{
            color: colors.textPrimary,
            fontSize: 17,
            fontWeight: '600',
            textAlign: 'center',
          }}
        >
          {isDeferredImport ? 'Import queued' : 'Importing...'}
        </Text>
        {isDeferredImport ? (
          <Text
            style={{
              color: colors.textSecondary,
              fontSize: 14,
              textAlign: 'center',
              maxWidth: 280,
            }}
          >
            Files imported from the Photos library are queued for import and
            uploaded in order
          </Text>
        ) : null}
      </View>
    )
  }, [isDeferredImport])

  const displayUri = fileUri || mediaLibraryUri || null
  const canDisplay = isDownloaded || !!mediaLibraryUri

  const LoadingPanel = useMemo(() => {
    return (
      <View
        style={[
          baseMediaStyle,
          { justifyContent: 'center', alignItems: 'center' },
        ]}
      >
        <ActivityIndicator color={colors.textSecondary} />
      </View>
    )
  }, [])

  const mediaContent = useMemo(() => {
    if (isProcessing && mediaLibraryLoading) return LoadingPanel
    if (isProcessing && !mediaLibraryUri) return ImportingPanel
    if (!canDisplay || !displayUri) return DownloadPanel

    if (type?.includes('image'))
      return (
        <ImageViewer
          uri={displayUri}
          style={baseMediaStyle}
          onZoomChange={onImageZoomChange}
        />
      )
    if (type?.includes('video'))
      return (
        <VideoPlayer
          source={displayUri}
          style={baseMediaStyle}
          onViewerControlPress={onViewerControlPress}
        />
      )
    if (type?.includes('audio')) {
      return (
        <AudioPlayer
          source={displayUri}
          filename={name}
          style={baseMediaStyle}
          onViewerControlPress={onViewerControlPress}
        />
      )
    }
    if (type?.includes('pdf') || lowerCasedFileName.endsWith('.pdf')) {
      return (
        <PDFViewer
          source={displayUri}
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
          uri={displayUri}
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
          uri={displayUri}
          style={textMediaStyle}
          onViewerControlPress={onViewerControlPress}
        />
      )
    }
    if (type?.includes('text/plain') || lowerCasedFileName.endsWith('.txt')) {
      return (
        <TextViewer
          uri={displayUri}
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
    LoadingPanel,
    ImportingPanel,
    isProcessing,
    mediaLibraryLoading,
    mediaLibraryUri,
    DownloadPanel,
    displayUri,
    canDisplay,
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
