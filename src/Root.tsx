import React, { useEffect } from 'react'
import { StyleSheet, Platform, StatusBar } from 'react-native'
import { palette } from './styles/colors'
import {
  DarkTheme,
  NavigationContainer,
  useNavigationContainerRef,
} from '@react-navigation/native'
import * as ScreenOrientation from 'expo-screen-orientation'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { ToastProvider } from './lib/toastContext'
import { initApp, shutdownApp, useShowSplash } from './stores/app'
import useLinkedURL from './hooks/useLinkedURL'
import { useReconnectIndexer } from './hooks/useReconnectIndexer'
import { RootTabs } from './stacks/RootTabs'
import { uniqueId } from './lib/uniqueId'
import { useHasOnboarded } from './stores/settings'
import { ShareIntentProvider } from 'expo-share-intent'
import { ShareIntentConsumer } from './components/ShareIntentConsumer'
import { AppSplash } from './components/AppSplash'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet'
import { AuthWebViewModal } from './components/AuthWebViewModal'

const darkNavigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: palette.gray[950],
    card: palette.gray[950],
    primary: palette.blue[400],
  },
}

export function Root() {
  const navigationRef = useNavigationContainerRef<any>()
  useReconnectIndexer()
  const { data: hasOnboarded } = useHasOnboarded()
  const showSplash = useShowSplash()

  useEffect(() => {
    initApp()
    return () => {
      shutdownApp()
    }
  }, [])

  useEffect(() => {
    ScreenOrientation.lockAsync(
      ScreenOrientation.OrientationLock.PORTRAIT_UP
    ).catch(() => {
      // Ignore failures caused by platform limitations or missing permissions.
    })
  }, [])

  useLinkedURL((shareUrl) => {
    // If we're onboarding, we want to ignore this import logic.
    if (!hasOnboarded) return

    try {
      new URL(shareUrl)
    } catch (error) {
      // Ignore invalid URLs.
      return
    }
    if (shareUrl && navigationRef.isReady() && isShareUrl(shareUrl)) {
      navigationRef.navigate('ImportTab', {
        screen: 'ImportFile',
        params: { shareUrl, id: uniqueId() },
      })
    }
  })

  return (
    <GestureHandlerRootView style={styles.gestureRoot}>
      <SafeAreaProvider>
        <ToastProvider>
          <SafeAreaView style={styles.safe} edges={['left', 'right']}>
            <StatusBar
              barStyle={Platform.select({
                ios: 'light-content',
                android: 'light-content',
                default: 'light-content',
              })}
            />
            <ShareIntentProvider>
              <BottomSheetModalProvider>
                {showSplash ? (
                  <AppSplash />
                ) : (
                  <>
                    <ShareIntentConsumer />
                    <NavigationContainer
                      ref={navigationRef}
                      theme={darkNavigationTheme}
                    >
                      <RootTabs />
                    </NavigationContainer>
                  </>
                )}
              </BottomSheetModalProvider>
              <AuthWebViewModal />
            </ShareIntentProvider>
          </SafeAreaView>
        </ToastProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

const styles = StyleSheet.create({
  gestureRoot: { flex: 1, backgroundColor: palette.gray[950] },
  safe: { flex: 1, backgroundColor: palette.gray[950] },
})

/** Determine if a URL is a share URL. */
function isShareUrl(urlString: string): boolean {
  try {
    const u = new URL(urlString)
    const path = u.pathname.toLowerCase()
    return path.includes('/objects') || path.includes('/shared')
  } catch (_e) {
    return false
  }
}
