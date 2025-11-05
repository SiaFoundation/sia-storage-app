import React, { useEffect } from 'react'
import { StyleSheet, View, Text, Pressable } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { palette } from '../styles/colors'
import BlocksGrid from '../components/BlocksGrid'
import { Button } from '../components/Button'
import { InputRow } from '../components/InputRow'
import { InfoCard } from '../components/InfoCard'
import { useChangeIndexer } from '../hooks/useChangeIndexer'
import BlocksLoader from '../components/BlocksLoader'
import BlocksShape from '../components/BlocksShape'
import { useIsConnected } from '../stores/sdk'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { AuthStackParamList } from '../stacks/types'
import { DEFAULT_INDEXER_URL } from '../config'

export default function ChooseIndexerScreen() {
  const nav = useNavigation<NativeStackNavigationProp<AuthStackParamList>>()
  const { top, bottom } = useSafeAreaInsets()
  const { newIndexerInputProps, saveAndOnboard, isWaiting, hasErrored } =
    useChangeIndexer()
  const isConnected = useIsConnected()

  const trimmedValue = newIndexerInputProps.value.trim()
  const isInputEmpty = trimmedValue.length === 0
  const isUsingCustomProvider = trimmedValue !== DEFAULT_INDEXER_URL
  const showWaiting = isWaiting || isConnected

  useEffect(() => {
    if (isConnected) {
      nav.navigate('FinishedOnboarding')
    }
  }, [isConnected])

  const handleBack = () => {
    if (nav.canGoBack()) {
      nav.goBack()
    }
  }

  const handleSelectDefault = () => {
    newIndexerInputProps.onChangeText(DEFAULT_INDEXER_URL)
  }

  const handleUseCustom = () => {
    if (!isUsingCustomProvider) {
      newIndexerInputProps.onChangeText('')
    }
  }

  const handleContinue = () => {
    void saveAndOnboard()
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
            <Text style={styles.waitingText}>
              {isConnected ? 'Connected' : 'Connecting...'}
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
              <Text style={styles.title}>Connect to a provider</Text>
            </View>
            <Text style={styles.subtitle}>
              Use our provider or link whichever one you prefer. This can be
              changed at any time.
            </Text>

            {hasErrored ? (
              <Text style={styles.errorText}>
                Could not connect. Check the URL and try again.
              </Text>
            ) : null}

            <InfoCard
              style={[
                styles.optionCard,
                !isUsingCustomProvider && styles.optionCardActive,
              ]}
            >
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ selected: !isUsingCustomProvider }}
                onPress={handleSelectDefault}
                style={styles.optionPressable}
              >
                <View style={styles.radioOuter}>
                  {!isUsingCustomProvider ? (
                    <View style={styles.radioInner} />
                  ) : null}
                </View>
                <View style={styles.optionText}>
                  <Text style={styles.optionTitle}>Sia Storage</Text>
                </View>
              </Pressable>
            </InfoCard>

            <InfoCard
              style={[
                styles.optionCard,
                isUsingCustomProvider && styles.optionCardActive,
              ]}
            >
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ selected: isUsingCustomProvider }}
                onPress={handleUseCustom}
                style={styles.optionPressable}
              >
                <View style={styles.radioOuter}>
                  {isUsingCustomProvider ? (
                    <View style={styles.radioInner} />
                  ) : null}
                </View>
                <View style={styles.optionText}>
                  <Text style={styles.optionTitle}>Enter a provider URL</Text>
                </View>
              </Pressable>
              {isUsingCustomProvider ? (
                <View style={styles.customInput}>
                  <InputRow
                    label="Provider URL"
                    align="left"
                    labelWidth={96}
                    keyboardType="url"
                    autoCorrect={false}
                    placeholder="https://"
                    {...newIndexerInputProps}
                  />
                </View>
              ) : null}
            </InfoCard>
          </View>
        )}
      </View>
      {!showWaiting ? (
        <View style={[styles.footer, { paddingBottom: bottom + 12 }]}>
          <Button
            variant="secondary"
            onPress={handleBack}
            style={styles.footerButton}
          >
            Back
          </Button>
          <Button
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
  errorText: { color: palette.red[500], fontSize: 12, textAlign: 'center' },

  optionCard: {
    padding: 20,
    gap: 16,
  },

  optionCardActive: {
    borderColor: palette.blue[400],
    backgroundColor: palette.gray[900],
  },

  optionPressable: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },

  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: palette.gray[600],
    alignItems: 'center',
    justifyContent: 'center',
  },

  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: palette.blue[400],
  },

  optionText: {
    flex: 1,
  },

  optionTitle: {
    color: palette.gray[50],
    fontSize: 16,
    fontWeight: '700',
  },

  customInput: {
    marginTop: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: palette.gray[950],
  },

  footer: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 20,
  },

  footerButton: {
    flex: 1,
  },
})
