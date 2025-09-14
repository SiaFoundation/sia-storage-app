import React from 'react'
import { useSettings } from '../lib/settingsContext'
import { AuthStack } from './AuthStack'
import { RootTabs } from './RootTabs'

export function Main() {
  const { isOnboarding } = useSettings()

  if (isOnboarding) {
    return <AuthStack />
  }

  return <RootTabs />
}
