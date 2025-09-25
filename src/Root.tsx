import React from 'react'
import { StyleSheet, Platform, StatusBar } from 'react-native'
import {
  NavigationContainer,
  useNavigationContainerRef,
} from '@react-navigation/native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { ToastProvider } from './lib/toastContext'
import { useInitLogger } from './stores/logs'
import { useEffect } from 'react'
import { initAuth } from './stores/auth'
import { initUploadScanner } from './stores/uploadScanner'
import { AppBanner } from './components/AppBanner'
import * as SplashScreen from 'expo-splash-screen'
import useLinkedURL from './hooks/useLinkedURL'
import { RootTabs } from './stacks/RootTabs'

SplashScreen.preventAutoHideAsync()

export function Root() {
  const navigationRef = useNavigationContainerRef<any>()
  useInitLogger()

  useEffect(() => {
    const init = async () => {
      await Promise.all([initAuth(), initUploadScanner()])
      setTimeout(() => {
        SplashScreen.hideAsync()
      }, 200)
    }
    init()
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
      <SafeAreaView style={styles.safe}>
        <StatusBar
          barStyle={Platform.select({
            ios: 'dark-content',
            android: 'dark-content',
            default: 'dark-content',
          })}
        />
        <ToastProvider>
          <NavigationContainer ref={navigationRef}>
            <AppBanner />
            <RootTabs />
          </NavigationContainer>
        </ToastProvider>
      </SafeAreaView>
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#ffffff' },
})
