import React, { useEffect } from 'react'
import { StyleSheet, Platform, StatusBar } from 'react-native'
import { palette } from './styles/colors'
import {
  NavigationContainer,
  useNavigationContainerRef,
} from '@react-navigation/native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { ToastProvider } from './lib/toastContext'
import {
  initApp,
  shutdownApp,
  useHasOnboardedStatus,
  useShowSplash,
} from './stores/app'
import useLinkedURL from './hooks/useLinkedURL'
import { useReconnectIndexer } from './hooks/useReconnectIndexer'
import { RootTabs } from './stacks/RootTabs'
import { uniqueId } from './lib/uniqueId'
import { ShareIntentProvider } from 'expo-share-intent'
import { ShareIntentConsumer } from './components/ShareIntentConsumer'
import { AppSplash } from './components/AppSplash'

export function Root() {
  const navigationRef = useNavigationContainerRef<any>()
  useReconnectIndexer()
  const hasOnboarded = useHasOnboardedStatus()
  const showSplash = useShowSplash()

  useEffect(() => {
    initApp()
    return () => {
      shutdownApp()
    }
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
    <SafeAreaProvider>
      <SafeAreaView style={styles.safe} edges={['left', 'right']}>
        <StatusBar
          barStyle={Platform.select({
            ios: 'light-content',
            android: 'light-content',
            default: 'light-content',
          })}
        />
        <ShareIntentProvider>
          <ToastProvider>
            {showSplash ? (
              <AppSplash />
            ) : (
              <>
                <ShareIntentConsumer />
                <NavigationContainer ref={navigationRef}>
                  <RootTabs />
                </NavigationContainer>
              </>
            )}
          </ToastProvider>
        </ShareIntentProvider>
      </SafeAreaView>
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
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
