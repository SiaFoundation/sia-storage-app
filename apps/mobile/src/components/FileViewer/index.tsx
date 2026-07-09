import { useDownloadEntry } from '@siastorage/core/stores'
import type { FileRecord } from '@siastorage/core/types'
import { CloudDownloadIcon, FileIcon } from 'lucide-react-native'
import { useCallback, useMemo } from 'react'
import { ActivityIndicator, StyleSheet, Text, TouchableHighlight, View } from 'react-native'
import { assertNever, useFileStatus } from '../../lib/file'
import { humanSize } from '../../lib/humanSize'
import { useDownload } from '../../managers/downloader'
import { colors } from '../../styles/colors'
import { AudioPlayer } from '../MediaConsumers/AudioPlayer'
import { ImageViewer } from '../MediaConsumers/ImageViewer'
import { JSONViewer } from '../MediaConsumers/JSONViewer'
import { MarkdownViewer } from '../MediaConsumers/MarkdownViewer'
import { PDFViewer } from '../MediaConsumers/PDFViewer'
import { TextViewer } from '../MediaConsumers/TextViewer'
import { VideoPlayer } from '../MediaConsumers/VideoPlayer'
import { pickViewerForFile } from './pickViewer'

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
  const status = useFileStatus(file, { isShared, resolvePhotosLookup: true })
  const phase = status.data?.phase
  const photosLookup = status.data?.photosLookup
  const photosDisplayUri = status.data?.photosDisplayUri ?? null
  const displayUri = status.data?.displayUri ?? null
  const isDownloading = status.data?.download.state === 'downloading'
  const fileDownload = useDownload(file, 0)
  const { data: fileDownloadState } = useDownloadEntry(file.id)

  const baseMediaStyle = styles.media
  const textMediaStyle = textTopInset
    ? StyleSheet.flatten([baseMediaStyle, { paddingTop: textTopInset }])
    : baseMediaStyle
  const textInsetValue = textTopInset && textTopInset > 0 ? textTopInset : undefined

  const onDownloadPress = useCallback(() => {
    if (onViewerControlPress) onViewerControlPress()
    if (isDownloading) return
    if (customDownloader) customDownloader()
    else fileDownload()
  }, [isDownloading, customDownloader, fileDownload, onViewerControlPress])

  const isQueued = fileDownloadState?.status === 'queued'

  const UnavailablePanel = useMemo(() => {
    return (
      <View style={[baseMediaStyle, { justifyContent: 'center', alignItems: 'center', gap: 12 }]}>
        <CloudDownloadIcon color={colors.textSecondary} size={40} />
        <Text style={{ color: colors.textPrimary, fontSize: 17, fontWeight: '600' }}>
          File unavailable
        </Text>
        <Text style={{ color: colors.textSecondary, fontSize: 14, textAlign: 'center' }}>
          This file was never uploaded and the local copy is unavailable.
        </Text>
      </View>
    )
    // oxlint-disable-next-line react/exhaustive-deps -- baseMediaStyle is a static StyleSheet reference, stable across renders
  }, [])

  const DownloadPanel = useMemo(() => {
    return (
      <View style={[baseMediaStyle, { justifyContent: 'center', alignItems: 'center', gap: 20 }]}>
        <TouchableHighlight onPress={onDownloadPress} disabled={isQueued}>
          <CloudDownloadIcon color={colors.textPrimary} size={40} />
        </TouchableHighlight>

        {!isDownloading && !isQueued ? (
          <Text style={{ color: colors.textPrimary }}>
            Press to download ({humanSize(file.size)})
          </Text>
        ) : null}

        {isQueued ? <Text style={{ color: colors.textPrimary }}>Download queued</Text> : null}

        {isDownloading && !isQueued ? (
          <Text style={{ color: colors.textPrimary }}>
            Downloading: {((fileDownloadState?.progress || 0) * 100).toFixed(0)}%
          </Text>
        ) : null}
      </View>
    )
    // oxlint-disable-next-line react/exhaustive-deps -- baseMediaStyle is a static StyleSheet reference, stable across renders
  }, [isDownloading, isQueued, onDownloadPress, fileDownloadState?.progress, file.size])

  const LoadingPanel = useMemo(() => {
    return (
      <View style={[baseMediaStyle, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={colors.textSecondary} />
      </View>
    )
    // oxlint-disable-next-line react/exhaustive-deps -- baseMediaStyle is a static StyleSheet reference, stable across renders
  }, [])

  const renderViewer = useCallback(
    (uri: string) => {
      const kind = pickViewerForFile(type, name)
      switch (kind) {
        case 'image':
          return <ImageViewer uri={uri} style={baseMediaStyle} onZoomChange={onImageZoomChange} />
        case 'video':
          return (
            <VideoPlayer
              source={uri}
              style={baseMediaStyle}
              onViewerControlPress={onViewerControlPress}
            />
          )
        case 'audio':
          return (
            <AudioPlayer
              source={uri}
              filename={name}
              style={baseMediaStyle}
              onViewerControlPress={onViewerControlPress}
            />
          )
        case 'pdf':
          return (
            <PDFViewer
              source={uri}
              style={baseMediaStyle}
              onSwipeLeft={onSwipeLeft}
              onSwipeRight={onSwipeRight}
            />
          )
        case 'json':
          return (
            <JSONViewer
              uri={uri}
              fileSize={file.size}
              style={baseMediaStyle}
              topInset={textInsetValue}
            />
          )
        case 'markdown':
          return (
            <MarkdownViewer
              uri={uri}
              style={textMediaStyle}
              onViewerControlPress={onViewerControlPress}
            />
          )
        case 'text':
          return (
            <TextViewer
              uri={uri}
              fileSize={file.size}
              style={baseMediaStyle}
              topInset={textInsetValue}
            />
          )
        case 'unsupported':
          return (
            <View
              style={[baseMediaStyle, { justifyContent: 'center', alignItems: 'center', gap: 20 }]}
            >
              <FileIcon color={colors.textPrimary} size={40} />
              <Text style={{ color: colors.textPrimary }}>Preview not supported</Text>
            </View>
          )
        default:
          return assertNever(kind)
      }
    },
    // oxlint-disable-next-line react/exhaustive-deps -- baseMediaStyle is a static StyleSheet reference, stable across renders
    [
      type,
      name,
      textInsetValue,
      textMediaStyle,
      file.size,
      onViewerControlPress,
      onSwipeLeft,
      onSwipeRight,
      onImageZoomChange,
    ],
  )

  const mediaContent = useMemo(() => {
    if (!phase) return LoadingPanel
    switch (phase.kind) {
      case 'import-failed':
        return UnavailablePanel
      case 'unavailable':
        // Edge case: hashed file with no local copy / no pinned objects.
        // Effectively unreachable in healthy code (eviction skips unpinned
        // files), but if it surfaces and Photos still has the original,
        // render it so the user can recover via re-import.
        return displayUri ? renderViewer(displayUri) : UnavailablePanel
      case 'upload-errored':
        return displayUri ? renderViewer(displayUri) : UnavailablePanel
      case 'pinned-remote-only':
      case 'downloading':
        return DownloadPanel
      case 'pinned-and-local':
      case 'local-only':
      case 'uploading':
        return displayUri ? renderViewer(displayUri) : DownloadPanel
      default:
        return assertNever(phase)
    }
    // oxlint-disable-next-line react/exhaustive-deps -- depend on phase?.kind/preview not phase to avoid identity churn from progress ticks
  }, [
    phase?.kind,
    photosLookup,
    photosDisplayUri,
    displayUri,
    LoadingPanel,
    UnavailablePanel,
    DownloadPanel,
    renderViewer,
  ])

  return <View style={styles.container}>{mediaContent}</View>
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'column' },
  media: { flex: 1 },
})
