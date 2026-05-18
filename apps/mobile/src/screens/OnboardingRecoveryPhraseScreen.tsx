import Clipboard from '@react-native-clipboard/clipboard'
import type { RouteProp } from '@react-navigation/native'
import { useNavigation, useRoute } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { logger } from '@siastorage/logger'
import { ArrowLeftIcon } from 'lucide-react-native'
import { useEffect, useRef, useState } from 'react'
import { Image, Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import ViewShot, { type ViewShotRef } from 'react-native-view-shot'
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
  const nav = useNavigation<NativeStackNavigationProp<OnboardingStackParamList>>()
  const route = useRoute<RouteProp<OnboardingStackParamList, 'RecoveryPhrase'>>()
  const { indexerURL } = route.params
  const { top, bottom } = useSafeAreaInsets()
  const toast = useToast()
  const [recoveryPhrase, setRecoveryPhrase] = useState('')

  const [ackSaved, setAckSaved] = useState(false)
  const [mode, setMode] = useState<'generated' | 'manual'>('generated')
  const [manualPhrase, setManualPhrase] = useState('')
  const [previewUri, setPreviewUri] = useState<string | null>(null)

  const { normalizedManualPhrase, isManualPhraseValid, manualValidationError } =
    useRecoveryPhraseValidation(manualPhrase)

  const { register, isSubmitting } = useRecoveryPhraseRegistration()
  const cardRef = useRef<ViewShotRef>(null)

  // Abort any in-flight auth poll and clear pending state before leaving.
  const handleBack = () => {
    cancelAuth()
    setPendingApproval(null)
    nav.goBack()
  }

  // Ensure onboarding starts with a fresh app key and no stale mnemonic
  // hash to validate against. Auto-generate a recovery phrase.
  useEffect(() => {
    app().auth.clearMnemonicHash()
    app().auth.clearAppKeys()
    app()
      .auth.generateRecoveryPhrase()
      .then((phrase) => setRecoveryPhrase(phrase))
  }, [])

  const handleContinue = async () => {
    try {
      const phrase = mode === 'generated' ? recoveryPhrase : normalizedManualPhrase
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

  const handlePreview = async () => {
    try {
      const uri = await cardRef.current?.capture?.()
      if (uri) {
        setPreviewUri(uri)
      }
    } catch (err) {
      logger.error('onboarding', 'recovery_phrase_preview_error', {
        error: err as Error,
      })
    }
  }

  const handleShare = async () => {
    if (previewUri) {
      try {
        const result = await Share.share({ url: previewUri })
        if (result.action === Share.sharedAction) {
          toast.show('Image saved')
          setPreviewUri(null)
        }
      } catch (err) {
        logger.error('onboarding', 'recovery_phrase_share_error', {
          error: err as Error,
        })
      }
    }
  }

  const canContinue =
    mode === 'generated' ? Boolean(recoveryPhrase) && ackSaved : isManualPhraseValid

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
      {previewUri ? (
        <>
          <Image
            source={{ uri: previewUri }}
            style={StyleSheet.absoluteFillObject}
            resizeMode="cover"
          />
          <Pressable
            testID="recovery-preview-back"
            onPress={() => setPreviewUri(null)}
            style={[styles.backButton, { top: top + 12 }]}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <ArrowLeftIcon color={palette.gray[50]} size={22} />
          </Pressable>
          <View style={[styles.previewFooter, { paddingBottom: bottom + 12 }]}>
            <Button testID="recovery-share-button" onPress={handleShare}>
              Save
            </Button>
          </View>
        </>
      ) : (
        <>
          <Pressable
            testID="recovery-back-button"
            onPress={handleBack}
            style={[styles.backButton, { top: top + 12 }]}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <ArrowLeftIcon color={palette.gray[50]} size={22} />
          </Pressable>
          <View style={[styles.centerWrap, { paddingTop: top, paddingBottom: bottom }]}>
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
                  {mode === 'generated' ? 'Recovery Phrase' : 'Welcome Back'}
                </Text>
              </View>

              <Text style={styles.subtitle}>
                {mode === 'generated'
                  ? 'This is the key to your account. Save it somewhere safe. It cannot be recovered if lost.'
                  : 'To restore your account, enter your 12 word recovery phrase below.'}
              </Text>

              {mode === 'generated' ? (
                <>
                  <View style={styles.phraseBox}>
                    <Text testID="recovery-phrase-text" style={styles.phraseText} selectable>
                      {recoveryPhrase}
                    </Text>
                  </View>

                  <View style={styles.actionsRow}>
                    <Button
                      testID="recovery-save-button"
                      variant="secondary"
                      onPress={handlePreview}
                      style={styles.button}
                      disabled={!recoveryPhrase}
                    >
                      Save Image
                    </Button>
                    <Button
                      testID="recovery-copy-button"
                      variant="secondary"
                      onPress={() => {
                        Clipboard.setString(recoveryPhrase)
                        toast.show('Copied')
                      }}
                      style={styles.button}
                      disabled={!recoveryPhrase}
                    >
                      Copy Text
                    </Button>
                  </View>

                  <Pressable testID="recovery-toggle-manual" onPress={() => setMode('manual')}>
                    <Text style={styles.toggleText}>Already have a recovery phrase?</Text>
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
                    <Text style={styles.toggleText}>Generate a new recovery phrase instead.</Text>
                  </Pressable>
                </>
              )}
            </View>
          </View>

          <View style={[styles.footer, { paddingBottom: bottom }]}>
            {mode === 'generated' ? (
              <Pressable
                testID="recovery-checkbox"
                onPress={() => setAckSaved((v) => !v)}
                style={styles.checkboxRow}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: ackSaved }}
              >
                <View style={[styles.checkboxBox, ackSaved && styles.checkboxBoxChecked]}>
                  {ackSaved ? <Text style={styles.checkMark}>✓</Text> : null}
                </View>
                <Text style={styles.checkboxLabel}>
                  I have recorded my recovery phrase somewhere safe.
                </Text>
              </Pressable>
            ) : null}

            <Button
              testID="recovery-continue-button"
              onPress={handleContinue}
              disabled={!canContinue || isSubmitting}
            >
              {isSubmitting ? 'Connecting...' : 'Continue'}
            </Button>
          </View>
        </>
      )}
      <ViewShot ref={cardRef} options={{ format: 'png', quality: 1 }} style={styles.hiddenCard}>
        <View style={styles.exportCard}>
          <BlocksGrid
            cols={5}
            rows={8}
            tileScale={0.12}
            animation="none"
            opacity={0.25}
            style={StyleSheet.absoluteFillObject}
          />
          <View style={styles.exportLogoWrap}>
            <Image
              source={require('../../assets/sia-storage-dark.png')}
              style={styles.exportLogo}
              resizeMode="contain"
            />
          </View>
          <View style={styles.exportPhraseWrap}>
            <View style={styles.exportPhraseBox}>
              <Text style={styles.exportPhraseText}>{recoveryPhrase}</Text>
            </View>
          </View>
        </View>
      </ViewShot>
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
    lineHeight: 22,
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
  },

  actionsRow: { flexDirection: 'row', gap: 12 },
  button: {
    flex: 1,
    borderWidth: 1,
    borderColor: palette.gray[700],
  },

  toggleText: {
    color: palette.gray[400],
    fontSize: 13,
    textAlign: 'center',
    textDecorationLine: 'underline',
  },

  previewFooter: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
  },

  hiddenCard: {
    position: 'absolute',
    left: -9999,
  },
  exportCard: {
    width: 390,
    height: 844,
    paddingHorizontal: 32,
    backgroundColor: '#000',
    alignItems: 'center',
    overflow: 'hidden',
  },
  exportLogoWrap: {
    position: 'absolute',
    top: '25%',
    alignItems: 'center',
    width: '100%',
  },
  exportPhraseWrap: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    paddingHorizontal: 32,
  },
  exportLogo: {
    width: 270,
    height: 270 * (84 / 325),
  },
  exportPhraseBox: {
    paddingHorizontal: 20,
    paddingVertical: 20,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.gray[700],
    backgroundColor: '#000',
  },
  exportPhraseText: {
    color: palette.gray[100],
    fontSize: 18,
    lineHeight: 28,
    textAlign: 'center',
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
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
