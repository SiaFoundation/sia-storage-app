import {
  ClockArrowUpIcon,
  CloudAlertIcon,
  CloudCheckIcon,
  CloudDownloadIcon,
  CloudUploadIcon,
} from 'lucide-react-native'
import { useCallback, useMemo } from 'react'
import { Pressable } from 'react-native'
import { assertNever, type FileStatus } from '../lib/file'
import { useToast } from '../lib/toastContext'
import { overlay, palette } from '../styles/colors'
import { CircularProgress } from './CircularProgress'
import { ExpandableBadge } from './ExpandableBadge'
import { SpinnerIcon } from './SpinnerIcon'

export function UploadStatusIcon({
  status,
  size = 16,
  variant = 'badge',
  color,
}: {
  status: FileStatus
  size?: number
  variant?: 'badge' | 'icon'
  color?: string
}) {
  const toast = useToast()
  const phase = status.phase
  const hasUploadError = status.upload.state === 'errored'
  const hasDownloadError = status.download.state === 'errored'
  const isErrorState =
    phase.kind === 'import-failed' ||
    phase.kind === 'upload-errored' ||
    phase.kind === 'unavailable' ||
    hasUploadError ||
    hasDownloadError
  const pillColor = isErrorState ? palette.red[500] : overlay.pill
  const iconColor = color ?? palette.gray[50]

  // Label that describes the file's underlying phase, ignoring overlays.
  // This is what the file IS, regardless of whether a transient upload or
  // download error is also present.
  const phaseLabel = useMemo(() => {
    switch (phase.kind) {
      case 'import-failed':
        return 'Import failed'
      case 'importing':
        return 'Importing'
      case 'upload-errored':
        return 'Upload error'
      case 'uploading':
        if (phase.isQueued) return 'Upload queued'
        return 'Uploading'
      case 'downloading':
        if (phase.isQueued) return 'Download queued'
        return 'Downloading'
      case 'pinned-and-local':
        return 'File on network and device'
      case 'pinned-remote-only':
        return 'File only on network'
      case 'local-only':
        return 'File only on device'
      case 'unavailable':
        return 'File unavailable'
      default:
        return assertNever(phase)
    }
  }, [phase])

  // Overlay summary fired only when an error layers on a non-error phase
  // (e.g., a pinned file with a failed re-upload). Null otherwise.
  const overlayLabel =
    hasUploadError && phase.kind !== 'upload-errored'
      ? 'Upload error'
      : hasDownloadError
        ? 'Download error'
        : null

  // Single visible label for accessibilityLabel and the icon-only badge:
  // overlay wins when present (it's the more urgent signal), else phase.
  const label = overlayLabel ?? phaseLabel

  const iconEL = useMemo(() => {
    // Overlay alert icon when an error layers on a non-error phase, so
    // the red pill doesn't get paired with a non-error icon.
    if ((hasUploadError || hasDownloadError) && phase.kind !== 'upload-errored') {
      return <CloudAlertIcon color={iconColor} size={size} />
    }
    switch (phase.kind) {
      case 'importing':
        return <ClockArrowUpIcon color={iconColor} size={size} />
      case 'import-failed':
      case 'upload-errored':
      case 'unavailable':
        return <CloudAlertIcon color={iconColor} size={size} />
      case 'uploading':
        // Queued = waiting in line, no active work yet — use the static
        // upload icon so the badge isn't animated when nothing's happening.
        if (phase.isQueued) return <CloudUploadIcon color={iconColor} size={size} />
        return phase.progress > 0 ? (
          <CircularProgress
            progress={phase.progress}
            size={size - 2}
            strokeWidth={1}
            progressColor={palette.green[500]}
          />
        ) : (
          <SpinnerIcon color={iconColor} size={size} />
        )
      case 'downloading':
        return <CloudDownloadIcon color={iconColor} size={size} />
      case 'pinned-and-local':
        return <CloudCheckIcon color={iconColor} size={size} />
      case 'pinned-remote-only':
        return <CloudDownloadIcon color={iconColor} size={size} />
      case 'local-only':
        return <CloudUploadIcon color={iconColor} size={size} />
      default:
        return assertNever(phase)
    }
  }, [phase, iconColor, size, hasUploadError, hasDownloadError])

  const showLabel = useCallback(() => {
    // Compose a structured toast: phase · overlay (if any) · error detail.
    // Preserves the context the icon-only badge can't show on its own.
    const parts: string[] = []
    if (overlayLabel) parts.push(phaseLabel, overlayLabel)
    else parts.push(phaseLabel)
    if (isErrorState && status.errorText && status.errorText !== phaseLabel) {
      parts.push(status.errorText)
    }
    const message = parts.filter(Boolean).join(' · ')
    if (message) toast.show(message, isErrorState ? { tone: 'error' } : undefined)
  }, [phaseLabel, overlayLabel, isErrorState, status.errorText, toast])

  if (variant === 'icon') {
    return (
      <Pressable onPress={showLabel} hitSlop={8} accessibilityLabel={`Status: ${label}`}>
        {iconEL}
      </Pressable>
    )
  }

  return (
    <Pressable onPress={showLabel} hitSlop={8} accessibilityLabel={`Status: ${label}`}>
      <ExpandableBadge
        label={label}
        size={size}
        interactive={false}
        backgroundColor={pillColor}
        borderColor={pillColor}
        textColor={palette.gray[50]}
        testID={`upload-status-${testIdFor(phase)}`}
      >
        {iconEL}
      </ExpandableBadge>
    </Pressable>
  )
}

function testIdFor(phase: FileStatus['phase']): string {
  switch (phase.kind) {
    case 'importing':
      return 'processing'
    case 'import-failed':
    case 'upload-errored':
    case 'unavailable':
      return 'error'
    case 'uploading':
      if (phase.isQueued) return 'queued'
      if (phase.isPacking) return 'packing'
      return 'uploading'
    case 'downloading':
    case 'pinned-and-local':
    case 'pinned-remote-only':
      return 'uploaded'
    case 'local-only':
      return 'local'
    default:
      return assertNever(phase)
  }
}
