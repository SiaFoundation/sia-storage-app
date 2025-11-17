import {
  CloudAlertIcon,
  CloudCheckIcon,
  CloudDownloadIcon,
  CloudUploadIcon,
} from 'lucide-react-native'
import { FileStatus } from '../lib/file'
import { overlay, palette } from '../styles/colors'
import { useMemo } from 'react'
import { ExpandableBadge } from './ExpandableBadge'
import { CircularProgress } from './CircularProgress'
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
    if (status.isUploadQueued) return 'Upload queued'
    if (status.isDownloadQueued) return 'Download queued'
    if (status.isUploading) return 'Uploading'
    if (status.isDownloading) return 'Downloading'
    if (status.isUploaded && status.isDownloaded)
      return 'File on network and device'
    if (status.isUploaded && !status.isDownloaded) return 'File only on network'
    if (!status.isUploaded && status.isDownloaded) return 'File only on device'
    return ''
  }, [status])

  const iconEL = status.isErrored ? (
    <CloudAlertIcon color={iconColor} size={size} />
  ) : status.isUploading ? (
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
      accessibilityLabel="Transfer status"
    >
      {iconEL}
    </ExpandableBadge>
  )
}
