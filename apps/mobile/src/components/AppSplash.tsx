import {
  useCurrentInitStep,
  useInitializationError,
  useSyncGateGuard,
  useSyncGateStatus,
  useSyncState,
} from '@siastorage/core/stores'
import { useEffect } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { acquireAutoKeepAwake, releaseAutoKeepAwake } from '../managers/autoKeepAwake'
import { palette } from '../styles/colors'
import { AppSplashError } from './AppSplashError'
import BlocksGrid from './BlocksGrid'
import BlocksLoader from './BlocksLoader'

function useSyncProgress() {
  const { data } = useSyncState()
  return {
    progress: data?.syncDownProgress ?? 0,
  }
}

export function AppSplash() {
  const currentStep = useCurrentInitStep()
  const initializationError = useInitializationError()
  const syncGateStatus = useSyncGateStatus()
  const { progress } = useSyncProgress()
  const { top, bottom } = useSafeAreaInsets()
  useSyncGateGuard()

  useEffect(() => {
    if (syncGateStatus !== 'active') return
    acquireAutoKeepAwake('sync-gate')
    return () => releaseAutoKeepAwake('sync-gate')
  }, [syncGateStatus])

  return (
    <SafeAreaView style={styles.screen}>
      <BlocksGrid
        cols={5}
        rows={12}
        tileScale={0.12}
        animation="swap"
        opacity={0.12}
        inset={{ top, bottom }}
        style={StyleSheet.absoluteFillObject}
      />
      <View style={[styles.centerWrap, { paddingTop: top + 12, paddingBottom: bottom + 12 }]}>
        {initializationError && currentStep ? (
          <AppSplashError step={currentStep} />
        ) : (
          <View style={styles.waitingWrap}>
            <BlocksLoader colorStart={1} size={20} />
            {syncGateStatus === 'active' ? (
              <>
                <View style={styles.syncHeader}>
                  <Text style={styles.syncTitle}>Syncing your library</Text>
                  <Text style={styles.syncSubtitle}>Catching up on new files...</Text>
                </View>
                <View style={styles.progressTrack}>
                  <View
                    style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]}
                  />
                </View>
              </>
            ) : (
              <Text style={styles.waitingText}>
                {currentStep?.message ?? 'Getting things ready...'}
              </Text>
            )}
          </View>
        )}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#000',
  },
  centerWrap: {
    flex: 1,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  waitingWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    gap: 24,
  },
  waitingText: {
    color: 'white',
    fontSize: 14,
  },
  syncHeader: {
    alignItems: 'center',
    gap: 6,
  },
  syncTitle: {
    color: 'white',
    fontSize: 20,
    fontWeight: '600',
  },
  syncSubtitle: {
    color: palette.gray[400],
    fontSize: 15,
    textAlign: 'center',
  },
  progressTrack: {
    width: '60%',
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.gray[800],
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: palette.gray[400],
  },
})
