import React from 'react'
import { TriangleAlertIcon, UploadCloudIcon } from 'lucide-react-native'
import { palette } from '../styles/colors'
import { useIsConnected } from '../stores/sdk'
import { useIsInitializing } from '../stores/app'
import { useHasOnboarded } from '../stores/settings'
import { useUploadScannerStatus } from '../managers/uploadScanner'

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

  if (!hasOnboarded || isInitializing) {
    return { visible: false, message: '', icon: null, level: 'info' }
  }

  if (!isConnected) {
    return {
      visible: true,
      message: 'Indexer not connected',
      icon: <TriangleAlertIcon size={14} color={palette.yellow[400]} />,
      level: 'warning',
    }
  }

  if (uploadsProgress.enabled && uploadsProgress.remaining > 0) {
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
