import { BottomSheetModalProvider } from '@gorhom/bottom-sheet'
import { DarkTheme, NavigationContainer, useNavigationContainerRef } from '@react-navigation/native'
import { AppProvider } from '@siastorage/core/app'
import { SWRConfig } from 'swr'
import { isSWREnabled } from './lib/swr'
import { uniqueId } from '@siastorage/core/lib/uniqueId'
import { useHasOnboarded, useShowSplash } from '@siastorage/core/stores'
import * as ScreenOrientation from 'expo-screen-orientation'
import { ShareIntentProvider } from 'expo-share-intent'
import { useEffect } from 'react'
import { Platform, StatusBar, StyleSheet } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { AppSplash } from './components/AppSplash'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ShareIntentConsumer } from './components/ShareIntentConsumer'
import useLinkedURL from './hooks/useLinkedURL'
import { useReconnectIndexer } from './hooks/useReconnectIndexer'
import { ToastProvider } from './lib/toastContext'
import { initApp, shutdownApp } from './managers/app'
import { RootTabs } from './stacks/RootTabs'
import { app } from './stores/appService'
import { palette } from './styles/colors'

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
  useEffect(() => {
    initApp()
    return () => {
      shutdownApp()
    }
  }, [])

  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {
      // Ignore failures caused by platform limitations or missing permissions.
    })
  }, [])

  return (
    <GestureHandlerRootView style={styles.gestureRoot}>
      <ErrorBoundary>
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
              <AppProvider value={app()}>
                <SWRConfig value={{ isPaused: () => !isSWREnabled() }}>
                  <RootContent />
                </SWRConfig>
              </AppProvider>
            </SafeAreaView>
          </ToastProvider>
        </SafeAreaProvider>
      </ErrorBoundary>
    </GestureHandlerRootView>
  )
}

function RootContent() {
  const navigationRef = useNavigationContainerRef<any>()
  useReconnectIndexer()
  const { data: hasOnboarded } = useHasOnboarded()
  const showSplash = useShowSplash()

  useLinkedURL((shareUrl) => {
    if (!hasOnboarded) return

    try {
      new URL(shareUrl)
    } catch (_error) {
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
    <ShareIntentProvider>
      <BottomSheetModalProvider>
        {showSplash ? (
          <AppSplash />
        ) : (
          <>
            <ShareIntentConsumer />
            <NavigationContainer ref={navigationRef} theme={darkNavigationTheme}>
              <RootTabs />
            </NavigationContainer>
          </>
        )}
      </BottomSheetModalProvider>
    </ShareIntentProvider>
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
