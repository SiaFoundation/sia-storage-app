import { useDownloadEntry } from '@siastorage/core/stores'
import type { FileRecord } from '@siastorage/core/types'
import { CloudDownloadIcon, FileIcon } from 'lucide-react-native'
import { useCallback, useMemo } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { assertNever, useFileStatus } from '../../lib/file'
import { useDownload } from '../../managers/downloader'
import { app } from '../../stores/appService'
import { useIsOnline } from '../../hooks/useIsOnline'
import { useIsConnected } from '../../stores/sdk'
import { colors } from '../../styles/colors'
import { AudioPlayer } from '../MediaConsumers/AudioPlayer'
import { ImageViewer } from '../MediaConsumers/ImageViewer'
import { JSONViewer } from '../MediaConsumers/JSONViewer'
import { MarkdownViewer } from '../MediaConsumers/MarkdownViewer'
import { PDFViewer } from '../MediaConsumers/PDFViewer'
import { TextViewer } from '../MediaConsumers/TextViewer'
import { VideoPlayer } from '../MediaConsumers/VideoPlayer'
import { DownloadPanel } from './DownloadPanel'
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
  const fileDownload = useDownload(file, 'user', { notifyOnInsufficientSpace: true })
  const { data: fileDownloadState } = useDownloadEntry(file.id)
  // The indexer flag stays set when the phone loses its network, so the
  // panel also needs the network itself to say it is offline.
  const indexerConnected = useIsConnected()
  const { data: isOnline } = useIsOnline()
  const isConnected = indexerConnected && isOnline !== false

  const baseMediaStyle = styles.media
  const textMediaStyle = useMemo(
    () => (textTopInset ? { ...baseMediaStyle, paddingTop: textTopInset } : baseMediaStyle),
    [baseMediaStyle, textTopInset],
  )
  const textInsetValue = textTopInset && textTopInset > 0 ? textTopInset : undefined

  const onDownloadPress = useCallback(async () => {
    if (onViewerControlPress) onViewerControlPress()
    if (customDownloader) customDownloader()
    else await fileDownload()
    // The panel leaves "Starting" when this settles, so the entry it reads is
    // refreshed first. Otherwise a retry that registered and failed again
    // before the next render would show the old failed entry, unchanged,
    // and nothing would move the panel on.
    await app().caches.downloads.invalidate(file.id)
  }, [customDownloader, fileDownload, onViewerControlPress, file.id])

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

  const downloadPanel = useMemo(
    () => (
      <DownloadPanel
        size={file.size}
        entry={fileDownloadState}
        isConnected={isConnected}
        onPress={onDownloadPress}
      />
    ),
    [file.size, fileDownloadState, isConnected, onDownloadPress],
  )

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
              file={file}
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
      file,
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
        return downloadPanel
      case 'pinned-and-local':
      case 'local-only':
      case 'uploading':
        return displayUri ? renderViewer(displayUri) : downloadPanel
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
    downloadPanel,
    renderViewer,
  ])

  return <View style={styles.container}>{mediaContent}</View>
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'column' },
  media: { flex: 1 },
})
