import { TriangleAlertIcon } from 'lucide-react-native'
import { Alert, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { resetApp } from '../managers/app'
import { useCurrentInitStep, useInitializationError } from '../stores/app'
import { palette } from '../styles/colors'
import BlocksGrid from './BlocksGrid'
import BlocksLoader from './BlocksLoader'
import { Button } from './Button'

export function AppSplash() {
  const currentStep = useCurrentInitStep()
  const initializationError = useInitializationError()
  const { top, bottom } = useSafeAreaInsets()

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
      <View
        style={[
          styles.centerWrap,
          { paddingTop: top + 12, paddingBottom: bottom + 12 },
        ]}
      >
        {initializationError && currentStep ? (
          <View style={styles.errorWrap}>
            <View style={styles.errorIconWrap}>
              <TriangleAlertIcon size={48} color={palette.red[500]} />
            </View>
            <Text style={styles.errorTitle}>{currentStep.label}</Text>
            <Text style={styles.errorMessage}>{currentStep.message}</Text>
            <Text style={styles.errorHint}>
              Please report this issue to the team or restart the app to try
              again.
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
            <Text style={styles.waitingText}>
              {currentStep?.message ?? 'Getting things ready...'}
            </Text>
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
    gap: 24,
  },
  waitingText: {
    color: 'white',
    fontSize: 14,
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
