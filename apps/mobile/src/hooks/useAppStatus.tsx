import { useHasOnboarded, useIsInitializing, useSyncState } from '@siastorage/core/stores'
import { CircleCheckIcon, TriangleAlertIcon } from 'lucide-react-native'
import type React from 'react'
import { SpinnerIcon } from '../components/SpinnerIcon'
import { compactUploadPercent } from '../lib/uploadPercent'
import { useIsConnected } from '../stores/sdk'
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
  const { data: syncState } = useSyncState()
  const isSyncingDown = syncState?.isSyncingDown ?? false
  const isSyncingUpMetadata = syncState?.isSyncingUp ?? false
  const isOnline = useIsOnline()

  if (!hasOnboarded || isInitializing) {
    return { visible: false, icon: null, level: 'info' }
  }

  if (typeof isOnline.data === 'boolean' && !isOnline.data) {
    return {
      visible: true,
      icon: <TriangleAlertIcon size={18} color={palette.yellow[400]} />,
      level: 'warning',
    }
  }

  if (!isConnected) {
    return {
      visible: true,
      icon: <TriangleAlertIcon size={18} color={palette.yellow[400]} />,
      level: 'warning',
    }
  }

  const isActive = uploadsProgress.show || isSyncingDown || isSyncingUpMetadata
  if (isActive) {
    const hint = uploadsProgress.show
      ? (compactUploadPercent(uploadsProgress.percentDecimal) ?? undefined)
      : undefined
    return {
      visible: true,
      icon: <SpinnerIcon size={18} color={palette.gray[50]} />,
      hint,
      level: 'info',
    }
  }

  return {
    visible: true,
    icon: <CircleCheckIcon size={18} color={palette.green[500]} />,
    level: 'info',
  }
}
