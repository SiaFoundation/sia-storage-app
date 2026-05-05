import {
  ClockArrowUpIcon,
  ClockIcon,
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

  const label = useMemo(() => {
    // Overlay an error summary when upload/download has an error on a
    // non-error phase (e.g., a pinned file with a failed re-upload).
    if (hasUploadError && phase.kind !== 'upload-errored') return 'Upload error'
    if (hasDownloadError) return 'Download error'
    switch (phase.kind) {
      case 'import-failed':
        return 'Import failed'
      case 'importing':
        return status.isDeferredImport ? 'Import queued' : 'Importing'
      case 'upload-errored':
        return phase.error || 'Upload error'
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
  }, [phase, hasUploadError, hasDownloadError, status.isDeferredImport])

  const iconEL = useMemo(() => {
    // Overlay alert icon when an error layers on a non-error phase, so
    // the red pill doesn't get paired with a non-error icon.
    if ((hasUploadError || hasDownloadError) && phase.kind !== 'upload-errored') {
      return <CloudAlertIcon color={iconColor} size={size} />
    }
    switch (phase.kind) {
      case 'importing':
        return status.isDeferredImport ? (
          <ClockIcon color={iconColor} size={size} />
        ) : (
          <ClockArrowUpIcon color={iconColor} size={size} />
        )
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
  }, [phase, iconColor, size, status.isDeferredImport, hasUploadError, hasDownloadError])

  const showLabel = useCallback(() => {
    // In an error state, prefer the underlying error text over the friendly
    // summary so the user can read what actually went wrong.
    const message = isErrorState && status.errorText ? status.errorText : label
    if (message) toast.show(message)
  }, [isErrorState, status.errorText, label, toast])

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
