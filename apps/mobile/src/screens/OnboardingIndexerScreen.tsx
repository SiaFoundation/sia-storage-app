import { useFocusEffect, useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { ArrowLeftIcon } from 'lucide-react-native'
import { useCallback, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import {
  KeyboardAwareScrollView,
  KeyboardProvider,
} from 'react-native-keyboard-controller'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import BlocksGrid from '../components/BlocksGrid'
import BlocksLoader from '../components/BlocksLoader'
import BlocksShape from '../components/BlocksShape'
import { Button } from '../components/Button'
import { IndexerSelector } from '../components/IndexerSelector'
import { useChangeIndexer } from '../hooks/useChangeIndexer'
import type { OnboardingStackParamList } from '../stacks/types'
import { cancelAuth } from '../stores/sdk'
import { palette } from '../styles/colors'

export default function OnboardingIndexerScreen() {
  const nav =
    useNavigation<NativeStackNavigationProp<OnboardingStackParamList>>()
  const { top, bottom } = useSafeAreaInsets()
  const { newIndexerInputProps, connectToIndexer, isWaiting, hasErrored } =
    useChangeIndexer()
  const [isNavigating, setIsNavigating] = useState(false)

  // Reset after navigating back from a later screen (e.g. RecoveryPhrase).
  useFocusEffect(
    useCallback(() => {
      setIsNavigating(false)
    }, []),
  )

  const trimmedValue = newIndexerInputProps.value.trim()
  const isInputEmpty = trimmedValue.length === 0
  const showWaiting = isWaiting || isNavigating

  // Abort any in-flight auth poll before leaving.
  const handleBack = () => {
    cancelAuth()
    nav.goBack()
  }

  const handleContinue = async () => {
    const indexerURL = newIndexerInputProps.value.trim()
    const result = await connectToIndexer()
    if (result.status === 'connected') {
      setIsNavigating(true)
      nav.navigate('FinishedOnboarding', { indexerURL })
    } else if (result.status === 'needsMnemonic') {
      setIsNavigating(true)
      nav.navigate('RecoveryPhrase', { indexerURL })
    }
    // If error, stay on screen (error already shown via toast).
  }

  return (
    <KeyboardProvider>
      <SafeAreaView style={styles.screen}>
        <Pressable
          testID="indexer-back-button"
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
              <Text testID="indexer-connecting-text" style={styles.waitingText}>
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
                <Text testID="indexer-title" style={styles.title}>
                  Connect to an indexer
                </Text>
              </View>
              <Text style={styles.subtitle}>
                An indexer backs up your encrypted file metadata and syncs it
                across devices. It cannot access your files. Files are stored on
                and retrieved directly from the Sia network. Use ours or connect
                your own.
              </Text>

              <IndexerSelector
                value={newIndexerInputProps.value}
                onChangeText={newIndexerInputProps.onChangeText}
                hasErrored={hasErrored}
              />
            </View>
          )}
        </KeyboardAwareScrollView>
        {!showWaiting ? (
          <View style={[styles.footer, { paddingBottom: bottom + 12 }]}>
            <Button
              testID="indexer-authorize-button"
              onPress={handleContinue}
              disabled={isInputEmpty}
            >
              Authorize
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
    gap: 16,
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

  waitingText: { color: 'white', fontSize: 14 },

  footer: {
    paddingHorizontal: 20,
  },
})
