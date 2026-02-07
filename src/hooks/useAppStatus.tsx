import {
  CircleCheckIcon,
  TriangleAlertIcon,
  UploadCloudIcon,
} from 'lucide-react-native'
import type React from 'react'
import { useIsInitializing } from '../stores/app'
import { useIsConnected } from '../stores/sdk'
import { useHasOnboarded } from '../stores/settings'
import { useUploadProgress } from '../stores/uploads'
import { palette } from '../styles/colors'
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
  const hasOnboarded = useHasOnboarded()
  const uploadsProgress = useUploadProgress()
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
