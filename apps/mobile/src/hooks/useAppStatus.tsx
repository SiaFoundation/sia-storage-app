import { useHasOnboarded, useIsInitializing, useSyncState } from '@siastorage/core/stores'
import {
  CircleCheckIcon,
  CloudDownloadIcon,
  CloudUploadIcon,
  TriangleAlertIcon,
} from 'lucide-react-native'
import type React from 'react'
import { compactUploadPercent } from '../lib/uploadPercent'
import { reconnectIndexer, useIsConnected } from '../stores/sdk'
import { useUploadProgress } from '../stores/uploads'
import { palette } from '../styles/colors'
import { useIsOnline } from './useIsOnline'

export type AppStatus = {
  visible: boolean
  icon: React.ReactElement | null
  /** One-line description of the current activity, suitable for a status row. */
  message: string
  /** Optional short trailing hint (e.g. upload percent). */
  hint?: string
  /** Optional trailing action surfaced next to the message. */
  action?: { label: string; onPress: () => void }
  /** True when the state is in-progress and the UI should show an "…" animation after the message. */
  animate: boolean
  level: 'info' | 'warning'
}

export function useAppStatus(): AppStatus {
  const isInitializing = useIsInitializing()
  const isConnected = useIsConnected()
  const hasOnboarded = useHasOnboarded()
  const uploadsProgress = useUploadProgress()
  const { data: syncState } = useSyncState()
  const isSyncingDown = syncState?.isSyncingDown ?? false
  const isSyncingUpMetadata = syncState?.isSyncingUp ?? false
  const isOnline = useIsOnline()

  if (!hasOnboarded || isInitializing) {
    return { visible: false, icon: null, message: '', animate: false, level: 'info' }
  }

  if (typeof isOnline.data === 'boolean' && !isOnline.data) {
    return {
      visible: true,
      icon: <TriangleAlertIcon size={18} color={palette.yellow[400]} />,
      message: 'No internet connection',
      animate: false,
      level: 'warning',
    }
  }

  if (!isConnected) {
    return {
      visible: true,
      icon: <TriangleAlertIcon size={18} color={palette.yellow[400]} />,
      message: "Can't reach indexer",
      action: { label: 'Reconnect', onPress: () => void reconnectIndexer() },
      animate: false,
      level: 'warning',
    }
  }

  if (uploadsProgress.show) {
    const { packerCount, packerFileCount, pendingFileCount, percentDecimal } = uploadsProgress
    if (packerCount > 0) {
      const isUploading = percentDecimal > 0
      const verb = isUploading ? 'Uploading' : 'Encrypting'
      const hint = isUploading ? (compactUploadPercent(percentDecimal) ?? undefined) : undefined
      // When real files are in flight, show the count. When only thumbnails
      // remain (packerFileCount === 0), keep the state but drop the number —
      // thumbnails still upload, but counting them confuses the user.
      const plural = packerFileCount === 1 ? 'file' : 'files'
      const message =
        packerFileCount > 0 ? `${verb} ${packerFileCount.toLocaleString()} ${plural}` : verb
      return {
        visible: true,
        icon: <CloudUploadIcon size={18} color={palette.blue[400]} />,
        message,
        hint,
        animate: true,
        level: 'info',
      }
    }
    // Pending branch: same treatment — number excludes thumbnails, but the
    // state stays visible while only thumbnails are pending.
    const plural = pendingFileCount === 1 ? 'file' : 'files'
    const message =
      pendingFileCount > 0
        ? `Importing ${pendingFileCount.toLocaleString()} ${plural}`
        : 'Importing'
    return {
      visible: true,
      icon: <CloudUploadIcon size={18} color={palette.blue[400]} />,
      message,
      animate: true,
      level: 'info',
    }
  }

  if (isSyncingDown) {
    return {
      visible: true,
      icon: <CloudDownloadIcon size={18} color={palette.blue[400]} />,
      message: 'Syncing metadata from indexer',
      animate: true,
      level: 'info',
    }
  }

  if (isSyncingUpMetadata) {
    const processed = syncState?.syncUpProcessed ?? 0
    const total = syncState?.syncUpTotal ?? 0
    const hint = total > 0 ? `${processed.toLocaleString()} / ${total.toLocaleString()}` : undefined
    return {
      visible: true,
      icon: <CloudUploadIcon size={18} color={palette.blue[400]} />,
      message: 'Syncing metadata to indexer',
      hint,
      animate: true,
      level: 'info',
    }
  }

  return {
    visible: true,
    icon: <CircleCheckIcon size={18} color={palette.green[500]} />,
    message: 'Online and synced',
    animate: false,
    level: 'info',
  }
}
