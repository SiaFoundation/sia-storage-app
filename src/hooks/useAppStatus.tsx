import React from 'react'
import {
  CircleCheckIcon,
  TriangleAlertIcon,
  UploadCloudIcon,
} from 'lucide-react-native'
import { palette } from '../styles/colors'
import { useIsConnected } from '../stores/sdk'
import { useHasOnboardedStatus, useIsInitializing } from '../stores/app'
import { useUploadScannerStatus } from '../managers/uploadScanner'
import { useIsOnline } from './useIsOnline'

export type AppStatus = {
  visible: boolean
  icon: React.ReactElement | null
  hint?: string
  level: 'info' | 'warning'
}

export function useAppStatus(): AppStatus {
  const isInitializing = useIsInitializing()
  const isConnected = useIsConnected()
  const hasOnboarded = useHasOnboardedStatus()
  const uploadsProgress = useUploadScannerStatus()
  const isOnline = useIsOnline()

  if (!hasOnboarded || isInitializing) {
    return { visible: false, icon: null, level: 'info' }
  }

  if (typeof isOnline.data === 'boolean' && !isOnline.data) {
    return {
      visible: true,
      icon: <TriangleAlertIcon size={14} color={palette.yellow[400]} />,
      level: 'warning',
    }
  }

  if (!isConnected) {
    return {
      visible: true,
      icon: <TriangleAlertIcon size={14} color={palette.yellow[400]} />,
      level: 'warning',
    }
  }

  if (uploadsProgress.show) {
    return {
      visible: true,
      icon: <UploadCloudIcon size={14} color={palette.gray[50]} />,
      hint: `${uploadsProgress.percentComplete}`,
      level: 'info',
    }
  }

  return {
    visible: true,
    icon: <CircleCheckIcon size={14} color={palette.green[500]} />,
    level: 'info',
  }
}
