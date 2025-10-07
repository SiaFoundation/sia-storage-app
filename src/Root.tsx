import React from 'react'
import { StyleSheet, Platform, StatusBar } from 'react-native'
import { palette } from './styles/colors'
import {
  NavigationContainer,
  useNavigationContainerRef,
} from '@react-navigation/native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { ToastProvider } from './lib/toastContext'
import { useEffect } from 'react'
import { initApp, shutdownApp } from './stores/app'
import * as SplashScreen from 'expo-splash-screen'
import useLinkedURL from './hooks/useLinkedURL'
import { RootTabs } from './stacks/RootTabs'

SplashScreen.preventAutoHideAsync()

export function Root() {
  const navigationRef = useNavigationContainerRef<any>()

  useEffect(() => {
    initApp()
    return () => {
      shutdownApp()
    }
  }, [])

  useLinkedURL((incomingUrl) => {
    try {
      const url = new URL(incomingUrl)
      const path = url.pathname.replace(/^\//, '')
      const host = url.host
      if (host === 'new-file' || path === 'new-file') {
        const shareUrl = url.searchParams.get('shareUrl') ?? undefined
        if (shareUrl && navigationRef.isReady()) {
          navigationRef.navigate('MainTab', {
            screen: 'ImportFile',
            params: { shareUrl },
          })
        }
      }
    } catch (_) {
      // Ignore invalid URLs.
    }
  })

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safe} edges={['left', 'right']}>
        <StatusBar
          barStyle={Platform.select({
            ios: 'light-content',
            android: 'light-content',
            default: 'light-content',
          })}
        />
        <ToastProvider>
          <NavigationContainer ref={navigationRef}>
            <RootTabs />
          </NavigationContainer>
        </ToastProvider>
      </SafeAreaView>
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.gray[950] },
})
