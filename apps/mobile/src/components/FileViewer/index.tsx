import { useDownloadEntry } from '@siastorage/core/stores'
import type { FileRecord } from '@siastorage/core/types'
import { ClockArrowUpIcon, ClockIcon, CloudDownloadIcon, FileIcon } from 'lucide-react-native'
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
  const importingPreview = phase?.kind === 'importing' ? phase.preview : null
  const photosLookup = status.data?.photosLookup
  const photosDisplayUri = status.data?.photosDisplayUri ?? null
  const displayUri = status.data?.displayUri ?? null
  const isDeferredImport = status.data?.isDeferredImport ?? false
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

  const lowerCasedFileName = useMemo(() => name?.toLowerCase() ?? '', [name])

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
            Files imported from the Photos library are queued for import and uploaded in order
          </Text>
        ) : null}
      </View>
    )
    // oxlint-disable-next-line react/exhaustive-deps -- baseMediaStyle is a static StyleSheet reference, stable across renders
  }, [isDeferredImport])

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
      if (type?.includes('image'))
        return <ImageViewer uri={uri} style={baseMediaStyle} onZoomChange={onImageZoomChange} />
      if (type?.includes('video'))
        return (
          <VideoPlayer
            source={uri}
            style={baseMediaStyle}
            onViewerControlPress={onViewerControlPress}
          />
        )
      if (type?.includes('audio'))
        return (
          <AudioPlayer
            source={uri}
            filename={name}
            style={baseMediaStyle}
            onViewerControlPress={onViewerControlPress}
          />
        )
      if (type?.includes('pdf') || lowerCasedFileName.endsWith('.pdf'))
        return (
          <PDFViewer
            source={uri}
            style={baseMediaStyle}
            onSwipeLeft={onSwipeLeft}
            onSwipeRight={onSwipeRight}
          />
        )
      if (type?.includes('application/json') || lowerCasedFileName.endsWith('.json'))
        return (
          <JSONViewer
            uri={uri}
            fileSize={file.size}
            style={baseMediaStyle}
            topInset={textInsetValue}
          />
        )
      if (
        type?.includes('text/markdown') ||
        lowerCasedFileName.endsWith('.md') ||
        lowerCasedFileName.endsWith('.markdown')
      )
        return (
          <MarkdownViewer
            uri={uri}
            style={textMediaStyle}
            onViewerControlPress={onViewerControlPress}
          />
        )
      if (type?.includes('text/plain') || lowerCasedFileName.endsWith('.txt'))
        return (
          <TextViewer
            uri={uri}
            fileSize={file.size}
            style={baseMediaStyle}
            topInset={textInsetValue}
          />
        )

      return (
        <View style={[baseMediaStyle, { justifyContent: 'center', alignItems: 'center', gap: 20 }]}>
          <FileIcon color={colors.textPrimary} size={40} />
          <Text style={{ color: colors.textPrimary }}>Preview not supported</Text>
        </View>
      )
    },
    // oxlint-disable-next-line react/exhaustive-deps -- baseMediaStyle is a static StyleSheet reference, stable across renders
    [
      type,
      lowerCasedFileName,
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
      case 'importing':
        switch (phase.preview) {
          case 'pending':
            return LoadingPanel
          case 'available':
            return displayUri ? renderViewer(displayUri) : ImportingPanel
          case 'none':
            return ImportingPanel
        }
        return ImportingPanel
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
    importingPreview,
    photosLookup,
    photosDisplayUri,
    displayUri,
    LoadingPanel,
    ImportingPanel,
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
