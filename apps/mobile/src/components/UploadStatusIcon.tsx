import {
  CloudAlertIcon,
  CloudCheckIcon,
  CloudDownloadIcon,
  CloudUploadIcon,
} from 'lucide-react-native'
import { useMemo } from 'react'
import type { FileStatus } from '../lib/file'
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
  const pillColor = status.isErrored ? palette.red[500] : overlay.pill
  const iconColor = color ?? palette.gray[50]

  const label = useMemo(() => {
    if (status.isErrored) return status.errorText || 'Error'
    if (status.isUploadQueued) return 'Queued'
    if (status.isDownloadQueued) return 'Download queued'
    if (status.isUploading || status.isPacking) return 'Uploading'
    if (status.isDownloading) return 'Downloading'
    if (status.isUploaded && status.isDownloaded)
      return 'File on network and device'
    if (status.isUploaded && !status.isDownloaded) return 'File only on network'
    if (!status.isUploaded && status.isDownloaded) return 'File only on device'
    return ''
  }, [status])

  const iconEL = status.isErrored ? (
    <CloudAlertIcon color={iconColor} size={size} />
  ) : status.isUploadQueued ? (
    <SpinnerIcon color={iconColor} size={size} />
  ) : status.isUploading || status.isPacking ? (
    status.uploadProgress > 0 ? (
      <CircularProgress
        progress={status.uploadProgress}
        size={size - 2}
        strokeWidth={1}
        progressColor={palette.green[500]}
      />
    ) : (
      <SpinnerIcon color={iconColor} size={size} />
    )
  ) : status.isUploaded ? (
    status.isDownloaded ? (
      <CloudCheckIcon color={iconColor} size={size} />
    ) : (
      <CloudDownloadIcon color={iconColor} size={size} />
    )
  ) : (
    <CloudUploadIcon color={iconColor} size={size} />
  )

  if (variant === 'icon') {
    return iconEL
  }

  return (
    <ExpandableBadge
      label={label}
      size={size}
      interactive={false}
      backgroundColor={pillColor}
      borderColor={pillColor}
      textColor={palette.gray[50]}
      accessibilityLabel={`Status: ${label}`}
      testID={`upload-status-${
        status.isErrored
          ? 'error'
          : status.isUploadQueued
            ? 'queued'
            : status.isPacking
              ? 'packing'
              : status.isUploading
                ? 'uploading'
                : status.isUploaded
                  ? 'uploaded'
                  : 'local'
      }`}
    >
      {iconEL}
    </ExpandableBadge>
  )
}
