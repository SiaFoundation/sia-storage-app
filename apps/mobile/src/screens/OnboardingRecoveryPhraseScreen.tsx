import Clipboard from '@react-native-clipboard/clipboard'
import type { RouteProp } from '@react-navigation/native'
import { useNavigation, useRoute } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { logger } from '@siastorage/logger'
import { ArrowLeftIcon } from 'lucide-react-native'
import { useEffect, useState } from 'react'
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import BlocksGrid from '../components/BlocksGrid'
import BlocksShape, { BLOCK_COLORS } from '../components/BlocksShape'
import { Button } from '../components/Button'
import { RecoveryPhraseInput } from '../components/RecoveryPhraseInput'
import { useRecoveryPhraseRegistration } from '../hooks/useRecoveryPhraseRegistration'
import { useRecoveryPhraseValidation } from '../hooks/useRecoveryPhraseValidation'
import { useToast } from '../lib/toastContext'
import type { OnboardingStackParamList } from '../stacks/types'
import { app } from '../stores/appService'
import { cancelAuth, setPendingApproval } from '../stores/sdk'
import { palette } from '../styles/colors'

export default function OnboardingRecoveryPhraseScreen() {
  const nav =
    useNavigation<NativeStackNavigationProp<OnboardingStackParamList>>()
  const route =
    useRoute<RouteProp<OnboardingStackParamList, 'RecoveryPhrase'>>()
  const { indexerURL } = route.params
  const { top, bottom } = useSafeAreaInsets()
  const toast = useToast()
  const [recoveryPhrase, setRecoveryPhrase] = useState('')

  const [ackSaved, setAckSaved] = useState(false)
  const [mode, setMode] = useState<'generated' | 'manual'>('generated')
  const [manualPhrase, setManualPhrase] = useState('')

  const { normalizedManualPhrase, isManualPhraseValid, manualValidationError } =
    useRecoveryPhraseValidation(manualPhrase)

  const { register, isSubmitting } = useRecoveryPhraseRegistration()

  // Abort any in-flight auth poll and clear pending state before leaving.
  const handleBack = () => {
    cancelAuth()
    setPendingApproval(null)
    nav.goBack()
  }

  // Ensure onboarding starts with a fresh app key and no stale mnemonic
  // hash to validate against.
  useEffect(() => {
    app().auth.clearMnemonicHash()
    app().auth.clearAppKeys()
  }, [])

  const handleContinue = async () => {
    try {
      const phrase =
        mode === 'generated' ? recoveryPhrase : normalizedManualPhrase
      const { success } = await register(phrase, indexerURL)
      if (success) {
        nav.navigate('FinishedOnboarding', { indexerURL })
      }
    } catch (err) {
      logger.error('onboarding', 'recovery_phrase_error', {
        error: err as Error,
      })
    }
  }

  const makeNewRecoveryPhrase = async () => {
    const phrase = await app().auth.generateRecoveryPhrase()
    setRecoveryPhrase(phrase)
    setAckSaved(false)
  }

  const canContinue =
    mode === 'generated'
      ? Boolean(recoveryPhrase) && ackSaved
      : isManualPhraseValid && ackSaved

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
      <Pressable
        testID="recovery-back-button"
        onPress={handleBack}
        style={[styles.backButton, { top: top + 12 }]}
        accessibilityRole="button"
        accessibilityLabel="Back"
      >
        <ArrowLeftIcon color={palette.gray[50]} size={22} />
      </Pressable>
      <View
        style={[styles.centerWrap, { paddingTop: top, paddingBottom: bottom }]}
      >
        <View style={styles.card}>
          <View style={styles.titleRow}>
            <View style={{ width: 16, height: 16, marginRight: 8 }}>
              <BlocksShape
                shape="block1"
                origin={{ x: 0, y: 0 }}
                tileSize={16}
                style={{ position: 'relative', width: 16, height: 16 }}
                palette={[BLOCK_COLORS[1]]}
                ringStart={0}
              />
            </View>
            <Text testID="recovery-title" style={styles.title}>
              Recovery Phrase
            </Text>
          </View>

          <Text style={styles.subtitle}>
            Your recovery phrase is the only way to access your data. Write it
            down and store it somewhere safe. If you lose it, your files cannot
            be recovered.
          </Text>

          {mode === 'generated' ? (
            <>
              <View style={styles.phraseBox}>
                <ScrollView
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                >
                  <Text
                    testID="recovery-phrase-text"
                    style={
                      recoveryPhrase
                        ? styles.phraseText
                        : styles.phrasePlaceholder
                    }
                    selectable={!!recoveryPhrase}
                  >
                    {recoveryPhrase ||
                      "Tap 'Generate new key' to create your recovery phrase"}
                  </Text>
                </ScrollView>
              </View>

              <View style={styles.actionsRow}>
                <Button
                  testID="recovery-generate-button"
                  variant="secondary"
                  onPress={makeNewRecoveryPhrase}
                  style={styles.button}
                >
                  Generate new key
                </Button>
                <Button
                  testID="recovery-copy-button"
                  variant="secondary"
                  onPress={() => {
                    Clipboard.setString(recoveryPhrase)
                    toast.show('Copied')
                  }}
                  style={styles.button}
                >
                  Copy
                </Button>
              </View>

              <Pressable
                testID="recovery-toggle-manual"
                onPress={() => setMode('manual')}
              >
                <Text style={styles.toggleText}>
                  Already have a recovery phrase?
                </Text>
              </Pressable>
            </>
          ) : (
            <>
              <RecoveryPhraseInput
                value={manualPhrase}
                onChangeText={setManualPhrase}
                isValid={isManualPhraseValid}
                normalizedValue={normalizedManualPhrase}
                validationError={manualValidationError}
                editable={!isSubmitting}
              />

              <Pressable
                testID="recovery-toggle-generated"
                onPress={() => setMode('generated')}
              >
                <Text style={styles.toggleText}>
                  Generate a new recovery phrase instead.
                </Text>
              </Pressable>
            </>
          )}
        </View>
      </View>

      <View style={[styles.footer, { paddingBottom: bottom }]}>
        <Pressable
          testID="recovery-checkbox"
          onPress={() => setAckSaved((v) => !v)}
          style={styles.checkboxRow}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: ackSaved }}
        >
          <View
            style={[styles.checkboxBox, ackSaved && styles.checkboxBoxChecked]}
          >
            {ackSaved ? <Text style={styles.checkMark}>✓</Text> : null}
          </View>
          <Text style={styles.checkboxLabel}>
            I have recorded my recovery phrase somewhere safe.
          </Text>
        </Pressable>

        <Button
          testID="recovery-continue-button"
          onPress={handleContinue}
          disabled={!canContinue || isSubmitting}
        >
          {isSubmitting ? 'Connecting...' : 'Continue'}
        </Button>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  backButton: {
    position: 'absolute',
    left: 16,
    zIndex: 1,
    padding: 4,
  },

  centerWrap: {
    flex: 1,
    alignItems: 'stretch',
    justifyContent: 'center',
  },

  card: {
    width: '100%',
    gap: 16,
    backgroundColor: '#000',
    paddingHorizontal: 20,
    paddingVertical: 28,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: palette.gray[800],
  },

  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  title: {
    color: palette.gray[100],
    fontSize: 26,
    fontWeight: '800',
  },
  subtitle: { color: palette.gray[300], fontSize: 14 },

  phraseBox: {
    height: 90,
    paddingHorizontal: 12,
    paddingVertical: 14,
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.gray[700],
    backgroundColor: '#000',
  },
  phraseText: {
    color: palette.gray[100],
    fontSize: 14,
    lineHeight: 20,
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
  },

  phrasePlaceholder: {
    color: palette.gray[500],
    fontSize: 14,
    lineHeight: 20,
  },

  actionsRow: { flexDirection: 'row', gap: 12 },
  button: { flex: 1 },

  toggleText: {
    color: palette.gray[400],
    fontSize: 13,
    textAlign: 'center',
    textDecorationLine: 'underline',
  },

  footer: {
    paddingHorizontal: 20,
    gap: 12,
  },

  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  checkboxBox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: palette.gray[600],
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  checkboxBoxChecked: {
    backgroundColor: palette.gray[200],
    borderColor: palette.gray[200],
  },
  checkMark: {
    color: '#000',
    fontSize: 14,
    lineHeight: 16,
    textAlign: 'center',
  },
  checkboxLabel: {
    color: palette.gray[200],
    fontSize: 13,
    flex: 1,
  },
})
