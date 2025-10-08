import React from 'react'
import { TriangleAlertIcon, UploadCloudIcon } from 'lucide-react-native'
import { palette } from '../styles/colors'
import { useIsConnected } from '../stores/sdk'
import { useIsInitializing } from '../stores/app'
import { useHasOnboarded } from '../stores/settings'
import { useUploadScannerStatus } from '../managers/uploadScanner'
import { useIsOnline } from './useIsOnline'

export type AppStatus = {
  visible: boolean
  message: string
  icon: React.ReactElement | null
  hint?: string
  level: 'info' | 'warning'
}

export function useAppStatus(): AppStatus {
  const isInitializing = useIsInitializing()
  const isConnected = useIsConnected()
  const hasOnboarded = useHasOnboarded()
  const uploadsProgress = useUploadScannerStatus()
  const isOnline = useIsOnline()

  if (!hasOnboarded || isInitializing) {
    return { visible: false, message: '', icon: null, level: 'info' }
  }

  if (typeof isOnline.data === 'boolean' && !isOnline.data) {
    return {
      visible: true,
      message: 'No internet connection',
      icon: <TriangleAlertIcon size={14} color={palette.yellow[400]} />,
      level: 'warning',
    }
  }

  if (!isConnected) {
    return {
      visible: true,
      message: 'Indexer not connected',
      icon: <TriangleAlertIcon size={14} color={palette.yellow[400]} />,
      level: 'warning',
    }
  }

  if (uploadsProgress.show) {
    return {
      visible: true,
      message: 'Uploading files to network',
      icon: <UploadCloudIcon size={14} color={palette.gray[50]} />,
      hint: `${uploadsProgress.percentComplete}`,
      level: 'info',
    }
  }

  return { visible: false, message: '', icon: null, level: 'info' }
}
