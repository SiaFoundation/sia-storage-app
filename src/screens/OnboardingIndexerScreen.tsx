import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import BlocksGrid from '../components/BlocksGrid'
import BlocksLoader from '../components/BlocksLoader'
import BlocksShape from '../components/BlocksShape'
import { Button } from '../components/Button'
import { IndexerSelector } from '../components/IndexerSelector'
import { useChangeIndexer } from '../hooks/useChangeIndexer'
import type { OnboardingStackParamList } from '../stacks/types'
import { palette } from '../styles/colors'

export default function OnboardingIndexerScreen() {
  const nav =
    useNavigation<NativeStackNavigationProp<OnboardingStackParamList>>()
  const { top, bottom } = useSafeAreaInsets()
  const { newIndexerInputProps, connectToIndexer, isWaiting, hasErrored } =
    useChangeIndexer()
  const [isNavigating, setIsNavigating] = useState(false)
  const trimmedValue = newIndexerInputProps.value.trim()
  const isInputEmpty = trimmedValue.length === 0
  const showWaiting = isWaiting || isNavigating

  const handleBack = () => {
    if (nav.canGoBack()) {
      nav.goBack()
    }
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
                Connect to a provider
              </Text>
            </View>
            <Text style={styles.subtitle}>
              Use our provider or link whichever one you prefer. This can be
              changed at any time.
            </Text>

            <IndexerSelector
              value={newIndexerInputProps.value}
              onChangeText={newIndexerInputProps.onChangeText}
              hasErrored={hasErrored}
            />
          </View>
        )}
      </View>
      {!showWaiting ? (
        <View style={[styles.footer, { paddingBottom: bottom + 12 }]}>
          <Button
            testID="indexer-back-button"
            variant="secondary"
            onPress={handleBack}
            style={styles.footerButton}
          >
            Back
          </Button>
          <Button
            testID="indexer-authorize-button"
            onPress={handleContinue}
            style={styles.footerButton}
            disabled={isInputEmpty}
          >
            Authorize
          </Button>
        </View>
      ) : null}
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

  content: {
    width: '100%',
    maxWidth: 560,
    gap: 16,
    padding: 20,
    backgroundColor: 'black',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.gray[800],
  },

  waitingWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
  },

  title: {
    color: palette.gray[100],
    fontSize: 28,
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
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 20,
  },

  footerButton: {
    flex: 1,
  },
})
