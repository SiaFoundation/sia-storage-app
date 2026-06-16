import { useFocusEffect, useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { ArrowLeftIcon, LockIcon } from 'lucide-react-native'
import { useCallback, useState } from 'react'
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { KeyboardAwareScrollView, KeyboardProvider } from 'react-native-keyboard-controller'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import BlocksGrid from '../components/BlocksGrid'
import BlocksLoader from '../components/BlocksLoader'
import BlocksShape from '../components/BlocksShape'
import { Button } from '../components/Button'
import { useChangeIndexer } from '../hooks/useChangeIndexer'
import { initApp } from '../managers/app'
import type { OnboardingStackParamList } from '../stacks/types'
import { app } from '../stores/appService'
import { cancelAuth } from '../stores/sdk'
import { colors, palette } from '../styles/colors'

export default function OnboardingAdvancedIndexerScreen() {
  const nav = useNavigation<NativeStackNavigationProp<OnboardingStackParamList>>()
  const { top, bottom } = useSafeAreaInsets()
  const { newIndexerInputProps, connectToIndexer, indexerURL, isWaiting, hasErrored } =
    useChangeIndexer()
  const [isNavigating, setIsNavigating] = useState(false)

  // Reset the field each time the screen is focused so the user starts fresh.
  // Depend on the stable onChangeText only — depending on the whole props object
  // re-ran this on every keystroke, clearing the input as the user typed.
  const resetInput = newIndexerInputProps.onChangeText
  useFocusEffect(
    useCallback(() => {
      setIsNavigating(false)
      resetInput('')
    }, [resetInput]),
  )

  const trimmedValue = newIndexerInputProps.value.trim()
  const isInputEmpty = trimmedValue.length === 0
  const showWaiting = isWaiting || isNavigating

  const handleBack = () => {
    cancelAuth()
    nav.goBack()
  }

  const handleContinue = async () => {
    const result = await connectToIndexer()
    if (result.status === 'connected') {
      setIsNavigating(true)
      app().init.setState({ isInitializing: true })
      await app().settings.setHasOnboarded(true)
      await initApp()
    } else if (result.status === 'needsMnemonic') {
      setIsNavigating(true)
      nav.navigate('RecoveryPhrase', { indexerURL })
    }
  }

  return (
    <KeyboardProvider>
      <SafeAreaView style={styles.screen}>
        <Pressable
          testID="advanced-indexer-back-button"
          onPress={handleBack}
          style={[styles.backButton, { top: top + 12 }]}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <ArrowLeftIcon color={palette.gray[50]} size={22} />
        </Pressable>
        <BlocksGrid
          cols={5}
          rows={12}
          tileScale={0.12}
          animation="swap"
          opacity={0.12}
          inset={{ top, bottom }}
          style={StyleSheet.absoluteFillObject}
        />

        <KeyboardAwareScrollView
          contentContainerStyle={[
            styles.centerWrap,
            { paddingTop: top + 12, paddingBottom: bottom + 12 },
          ]}
          keyboardShouldPersistTaps="handled"
          bottomOffset={20}
        >
          {showWaiting ? (
            <View style={styles.waitingWrap}>
              <BlocksLoader colorStart={1} size={20} />
              <Text testID="advanced-indexer-connecting-text" style={styles.waitingText}>
                {isNavigating ? 'Connected' : 'Connecting...'}
              </Text>
            </View>
          ) : (
            <View style={styles.content}>
              <View style={styles.titleRow}>
                <View style={styles.titleIcon}>
                  <BlocksShape
                    shape="line2"
                    tileSize={12}
                    origin={{ x: 0, y: 0 }}
                    rotation={90}
                    style={styles.titleIconGlyph}
                  />
                </View>
                <Text testID="advanced-indexer-title" style={styles.title}>
                  Custom Indexer
                </Text>
              </View>

              <Text style={styles.subtitle}>
                An indexer stores encrypted file metadata and syncs it across devices. You can run
                your own using{' '}
                <Text
                  style={styles.link}
                  onPress={() => Linking.openURL('https://github.com/siafoundation/indexd')}
                >
                  indexd
                </Text>
                .
              </Text>

              {hasErrored ? (
                <Text style={styles.errorText}>
                  Could not connect. Check the URL and try again.
                </Text>
              ) : null}

              <Text style={styles.inputLabel}>Your Indexer URL</Text>
              <View style={styles.inputRow}>
                <View style={styles.inputPrefix}>
                  <LockIcon color={palette.gray[400]} size={13} />
                  <Text style={styles.inputPrefixText}>https://</Text>
                </View>
                <TextInput
                  testID="advanced-indexer-url-input"
                  style={styles.textInputField}
                  placeholder="your-indexer.com"
                  placeholderTextColor={palette.gray[400]}
                  keyboardType="url"
                  autoCorrect={false}
                  autoCapitalize="none"
                  value={newIndexerInputProps.value}
                  onChangeText={newIndexerInputProps.onChangeText}
                />
              </View>
            </View>
          )}
        </KeyboardAwareScrollView>
        {!showWaiting ? (
          <View style={[styles.footer, { paddingBottom: bottom + 12 }]}>
            <Button
              testID="advanced-indexer-continue-button"
              onPress={handleContinue}
              disabled={isInputEmpty}
            >
              Continue
            </Button>
          </View>
        ) : null}
      </SafeAreaView>
    </KeyboardProvider>
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
    flexGrow: 1,
    alignItems: 'stretch',
    justifyContent: 'center',
  },

  content: {
    width: '100%',
    gap: 12,
    backgroundColor: '#000',
    paddingHorizontal: 20,
    paddingVertical: 28,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: palette.gray[800],
  },

  waitingWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
  },

  title: {
    color: palette.gray[100],
    fontSize: 24,
    fontWeight: '800',
  },

  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  titleIcon: {
    width: 24,
    height: 12,
    position: 'relative',
  },

  titleIconGlyph: {
    width: 24,
    height: 12,
  },

  subtitle: { color: palette.gray[300], fontSize: 14 },

  link: {
    color: palette.blue[400],
    textDecorationLine: 'underline',
  },

  inputLabel: {
    color: palette.gray[300],
    fontSize: 13,
    fontWeight: '600',
  },

  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: palette.gray[950],
    borderRadius: 8,
    paddingHorizontal: 12,
  },

  inputPrefix: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingRight: 8,
    marginRight: 8,
    borderRightWidth: 1,
    borderRightColor: palette.gray[800],
  },

  inputPrefixText: {
    color: palette.gray[400],
    fontSize: 16,
  },

  textInputField: {
    flex: 1,
    color: colors.textPrimary,
    paddingVertical: 12,
    fontSize: 16,
  },

  errorText: {
    color: palette.red[500],
    fontSize: 12,
  },

  waitingText: { color: 'white', fontSize: 14 },

  footer: {
    paddingHorizontal: 20,
  },
})
