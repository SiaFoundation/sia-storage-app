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
import type { FileStatus } from '../lib/file'
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
  const pillColor = status.isErrored || status.fileIsGone ? palette.red[500] : overlay.pill
  const iconColor = color ?? palette.gray[50]

  const label = useMemo(() => {
    if (status.isImportFailed) return 'Import failed'
    if (status.isDeferredImport) return 'Import queued'
    if (status.isProcessing) return 'Importing'
    if (status.isErrored) return status.errorText || 'Error'
    if (status.isUploadQueued) return 'Queued'
    if (status.isDownloadQueued) return 'Download queued'
    if (status.isPacking) return 'Encrypting'
    if (status.isUploading) return 'Uploading'
    if (status.isDownloading) return 'Downloading'
    if (status.isUploaded && status.isDownloaded) return 'File on network and device'
    if (status.isUploaded && !status.isDownloaded) return 'File only on network'
    if (!status.isUploaded && status.isDownloaded) return 'File only on device'
    if (status.fileIsGone) return 'File unavailable'
    return ''
  }, [status])

  const iconEL = status.isDeferredImport ? (
    <ClockIcon color={iconColor} size={size} />
  ) : status.isProcessing ? (
    <ClockArrowUpIcon color={iconColor} size={size} />
  ) : status.isErrored ? (
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
  ) : status.fileIsGone ? (
    <CloudAlertIcon color={iconColor} size={size} />
  ) : status.isUploaded ? (
    status.isDownloaded ? (
      <CloudCheckIcon color={iconColor} size={size} />
    ) : (
      <CloudDownloadIcon color={iconColor} size={size} />
    )
  ) : (
    <CloudUploadIcon color={iconColor} size={size} />
  )

  const showLabel = useCallback(() => {
    if (label) toast.show(label)
  }, [label, toast])

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
        testID={`upload-status-${
          status.isProcessing
            ? 'processing'
            : status.isErrored
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
    </Pressable>
  )
}
