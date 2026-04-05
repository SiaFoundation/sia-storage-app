import {
  useCurrentInitStep,
  useInitializationError,
  useSyncGateGuard,
  useSyncGateStatus,
  useSyncState,
} from '@siastorage/core/stores'
import { TriangleAlertIcon } from 'lucide-react-native'
import { Alert, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { resetApp } from '../managers/app'
import { palette } from '../styles/colors'
import BlocksGrid from './BlocksGrid'
import BlocksLoader from './BlocksLoader'
import { Button } from './Button'

function useSyncProgress() {
  const { data } = useSyncState()
  return {
    count: data?.syncDownCount ?? 0,
    progress: data?.syncDownProgress ?? 0,
  }
}

export function AppSplash() {
  const currentStep = useCurrentInitStep()
  const initializationError = useInitializationError()
  const syncGateStatus = useSyncGateStatus()
  const { count, progress } = useSyncProgress()
  const { top, bottom } = useSafeAreaInsets()
  useSyncGateGuard()

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
          <View style={styles.errorWrap}>
            <View style={styles.errorIconWrap}>
              <TriangleAlertIcon size={48} color={palette.red[500]} />
            </View>
            <Text style={styles.errorTitle}>{currentStep.label}</Text>
            <Text style={styles.errorMessage}>{currentStep.message}</Text>
            <Text style={styles.errorHint}>
              Please report this issue to the team or restart the app to try again.
            </Text>
            <Button
              variant="danger"
              style={styles.resetButton}
              onPress={() => {
                Alert.alert(
                  'Reset Application',
                  'This will delete all local metadata. This cannot be undone.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Permanently reset',
                      style: 'destructive',
                      onPress: () => resetApp(),
                    },
                  ],
                )
              }}
            >
              Reset application
            </Button>
          </View>
        ) : (
          <View style={styles.waitingWrap}>
            <BlocksLoader colorStart={1} size={20} />
            {syncGateStatus === 'active' ? (
              <>
                <View style={styles.syncHeader}>
                  <Text style={styles.syncTitle}>Syncing your library</Text>
                  <Text style={styles.syncSubtitle}>Syncing your files from the indexer.</Text>
                </View>
                {count > 0 && (
                  <Text style={styles.syncCounts}>{count.toLocaleString()} files synced</Text>
                )}
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
  syncCounts: {
    color: palette.gray[500],
    fontSize: 12,
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
  errorWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    maxWidth: '80%',
  },
  errorIconWrap: {
    paddingBottom: 8,
  },
  errorTitle: {
    color: 'white',
    fontSize: 20,
    fontWeight: '700',
  },
  errorMessage: {
    color: palette.red[500],
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  errorHint: {
    color: palette.gray[400],
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  resetButton: {
    marginTop: 16,
    alignSelf: 'stretch',
  },
})
