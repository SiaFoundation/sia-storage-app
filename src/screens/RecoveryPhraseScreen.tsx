import React, { useEffect, useState } from 'react'
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  Platform,
  Pressable,
  ScrollView,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import type { AuthStackParamList } from '../stacks/types'
import { palette } from '../styles/colors'
import BlocksGrid from '../components/BlocksGrid'
import BlocksShape, { BLOCK_COLORS } from '../components/BlocksShape'
import { Button } from '../components/Button'
import { useToast } from '../lib/toastContext'
import { useRecoveryPhrase, setRecoveryPhrase } from '../stores/settings'
import { generateRecoveryPhrase } from 'react-native-sia'
import { useCopyRecoveryPhrase } from '../hooks/useCopyRecoveryPhrase'

export default function RecoveryPhraseScreen() {
  const nav = useNavigation<NativeStackNavigationProp<AuthStackParamList>>()
  const { top, bottom } = useSafeAreaInsets()
  const toast = useToast()
  const copyRecoveryPhrase = useCopyRecoveryPhrase()
  const recoveryPhrase = useRecoveryPhrase()

  const [ackSaved, setAckSaved] = useState(false)
  const [mode, setMode] = useState<'generated' | 'manual'>('generated')
  const [manualPhrase, setManualPhrase] = useState('')

  const makeNewRecoveryPhrase = async () => {
    await setRecoveryPhrase(generateRecoveryPhrase())
    setAckSaved(false)
  }

  // This validation is not likely enough and should be expanded.
  const validateRecoveryPhrase = (phrase: string): boolean => {
    const phraseArray = phrase.split(' ')
    if (phraseArray.length === 12 || phraseArray.length === 24) {
      return true
    }
    return false
  }

  const isManualPhraseValid = validateRecoveryPhrase(manualPhrase)

  const canContinue =
    mode === 'generated'
      ? Boolean(recoveryPhrase.data) && ackSaved
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
            <Text style={styles.title}>Recovery Phrase</Text>
          </View>

          <Text style={styles.subtitle}>
            Generate your master key and save this phrase somewhere secure--such
            as a password manager or hard copy. Do not ever share it with
            anyone.
          </Text>

          {mode === 'generated' ? (
            <>
              <View style={styles.phraseBox}>
                <ScrollView
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                >
                  <Text style={styles.phraseText} selectable>
                    {recoveryPhrase.data ?? ''}
                  </Text>
                </ScrollView>
              </View>

              <View style={styles.actionsRow}>
                <Button
                  variant="secondary"
                  onPress={makeNewRecoveryPhrase}
                  style={styles.button}
                >
                  Generate new key
                </Button>
                <Button
                  variant="secondary"
                  onPress={async () => {
                    await copyRecoveryPhrase()
                    toast.show('Copied')
                  }}
                  style={styles.button}
                >
                  Copy
                </Button>
              </View>

              <Pressable onPress={() => setMode('manual')}>
                <Text style={styles.toggleText}>
                  Already have a recovery phrase?
                </Text>
              </Pressable>
            </>
          ) : (
            <>
              <View
                style={[
                  styles.inputBox,
                  isManualPhraseValid
                    ? styles.inputBoxValid
                    : manualPhrase
                    ? styles.inputBoxInvalid
                    : styles.inputBoxNeutral,
                ]}
              >
                <TextInput
                  value={manualPhrase}
                  onChangeText={setManualPhrase}
                  placeholder="Enter your 12 or 24 word recovery phrase"
                  placeholderTextColor={palette.gray[500]}
                  multiline
                  scrollEnabled
                  style={styles.textInput}
                  autoCapitalize="none"
                  autoCorrect={false}
                  textAlignVertical="center"
                />
              </View>

              {manualPhrase ? (
                <Text
                  style={[
                    styles.validationText,
                    isManualPhraseValid
                      ? styles.validationTextValid
                      : styles.validationTextInvalid,
                  ]}
                >
                  {isManualPhraseValid
                    ? 'Recovery phrase looks valid.'
                    : 'Invalid recovery phrase.'}
                </Text>
              ) : null}

              <Pressable onPress={() => setMode('generated')}>
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
          onPress={() => nav.navigate('ChooseIndexer')}
          disabled={!canContinue}
        >
          Continue
        </Button>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },

  centerWrap: {
    flex: 1,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },

  card: {
    width: '100%',
    maxWidth: 560,
    gap: 16,
    padding: 20,
    backgroundColor: 'black',
    borderRadius: 12,
    borderWidth: 1,
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

  inputBox: {
    height: 90,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: '#000',
  },
  inputBoxNeutral: { borderColor: palette.gray[700] },
  inputBoxValid: { borderColor: palette.green[500] },
  inputBoxInvalid: { borderColor: palette.red[500] },

  textInput: {
    color: palette.gray[100],
    fontSize: 14,
    lineHeight: 20,
    paddingVertical: 0,
    flex: 1,
    textAlign: 'left',
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
  },

  validationText: { fontSize: 13 },
  validationTextValid: { color: palette.green[500] },
  validationTextInvalid: { color: palette.red[500] },

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
