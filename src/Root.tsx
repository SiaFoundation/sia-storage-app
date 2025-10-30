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
import { useReconnectIndexer } from './hooks/useReconnectIndexer'
import { RootTabs } from './stacks/RootTabs'
import { uniqueId } from './lib/uniqueId'

SplashScreen.preventAutoHideAsync()

export function Root() {
  const navigationRef = useNavigationContainerRef<any>()
  useReconnectIndexer()

  useEffect(() => {
    initApp()
    return () => {
      shutdownApp()
    }
  }, [])

  useLinkedURL((shareUrl) => {
    try {
      new URL(shareUrl)
    } catch (error) {
      // Ignore invalid URLs.
      return
    }
    if (shareUrl && navigationRef.isReady()) {
      navigationRef.navigate('ImportTab', {
        screen: 'ImportFile',
        params: { shareUrl, id: uniqueId() },
      })
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
