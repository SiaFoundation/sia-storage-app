import { useFocusEffect, useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { SettingsIcon } from 'lucide-react-native'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Animated, Easing, Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import BlocksGrid from '../components/BlocksGrid'
import BlocksLoader from '../components/BlocksLoader'
import { SHAPES } from '../components/BlocksShape'
import { Button } from '../components/Button'
import { useChangeIndexer } from '../hooks/useChangeIndexer'
import { initApp } from '../managers/app'
import type { OnboardingStackParamList } from '../stacks/types'
import { app } from '../stores/appService'
import { palette } from '../styles/colors'

const typeFadeDurationMs = 500
const typeFadeStaggerMs = 250
const shapeTypeCount = Object.keys(SHAPES).length
const totalTypeFadeMs = typeFadeDurationMs + (shapeTypeCount - 1) * typeFadeStaggerMs

const gridDimTarget = 0.12
const gridDimDurationMs = 700
const contentFadeDurationMs = 600

export default function OnboardingWelcomeScreen() {
  const nav = useNavigation<NativeStackNavigationProp<OnboardingStackParamList>>()
  const { top, bottom } = useSafeAreaInsets()
  const { connectToIndexer, indexerURL, isWaiting } = useChangeIndexer()
  const [isNavigating, setIsNavigating] = useState(false)

  const gridOpacity = useRef(new Animated.Value(1)).current
  const contentOpacity = useRef(new Animated.Value(0)).current

  const showWaiting = isWaiting || isNavigating

  useFocusEffect(
    useCallback(() => {
      setIsNavigating(false)
    }, []),
  )

  useEffect(() => {
    gridOpacity.setValue(1)
    contentOpacity.setValue(0)

    const t = setTimeout(() => {
      Animated.parallel([
        Animated.timing(gridOpacity, {
          toValue: gridDimTarget,
          duration: gridDimDurationMs,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(contentOpacity, {
          toValue: 1,
          duration: contentFadeDurationMs,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start()
    }, totalTypeFadeMs)

    return () => clearTimeout(t)
  }, [gridOpacity, contentOpacity])

  const handleSignIn = async () => {
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
    <SafeAreaView style={styles.screen}>
      <Animated.View
        style={[StyleSheet.absoluteFillObject, { opacity: gridOpacity }]}
        pointerEvents="none"
      >
        <BlocksGrid
          cols={5}
          rows={12}
          tileScale={0.15}
          animation="typeFade"
          style={{ flex: 1 }}
          inset={{ top, bottom }}
        />
      </Animated.View>

      <Animated.View style={[styles.advancedWrap, { opacity: contentOpacity }]}>
        <Pressable
          testID="welcome-advanced-button"
          onPress={() => nav.navigate('AdvancedIndexer')}
          style={[styles.advancedButton, { top: top + 12 }]}
          accessibilityRole="button"
          accessibilityLabel="Custom indexer"
        >
          <SettingsIcon color={palette.gray[400]} size={20} />
        </Pressable>
      </Animated.View>

      {showWaiting ? (
        <View style={styles.waitingWrap}>
          <BlocksLoader colorStart={1} size={20} />
          <Text testID="welcome-connecting-text" style={styles.waitingText}>
            {isNavigating ? 'Connected' : 'Connecting...'}
          </Text>
        </View>
      ) : (
        <>
          <Animated.View style={[styles.contentWrap, { opacity: contentOpacity }]}>
            <View style={styles.card}>
              <View style={styles.center}>
                <Image
                  source={require('../../assets/sia-storage-dark.png')}
                  style={styles.logo}
                  resizeMode="contain"
                />
                <Text style={styles.subtitle}>The world's safest cloud storage, by design.</Text>
              </View>
            </View>
          </Animated.View>

          <Animated.View
            style={[styles.footer, { opacity: contentOpacity, paddingBottom: bottom + 12 }]}
          >
            <Button
              testID="welcome-sign-in-button"
              style={styles.footerButton}
              onPress={handleSignIn}
            >
              Sign In
            </Button>
          </Animated.View>
        </>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },

  advancedWrap: {
    position: 'absolute',
    right: 0,
    zIndex: 1,
  },
  advancedButton: {
    position: 'absolute',
    right: 16,
    padding: 4,
  },

  contentWrap: {
    flex: 1,
    alignItems: 'stretch',
    justifyContent: 'center',
  },

  card: {
    width: '100%',
    paddingHorizontal: 20,
    paddingVertical: 40,
    backgroundColor: '#000',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: palette.gray[800],
  },

  center: {
    alignItems: 'center',
  },

  logo: {
    width: 260,
    height: 260 * (84 / 325),
  },

  subtitle: {
    color: palette.gray[400],
    fontSize: 15,
    textAlign: 'center',
    marginTop: 20,
  },

  waitingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
  },

  waitingText: { color: 'white', fontSize: 14 },

  footer: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 20,
  },

  footerButton: { flex: 1 },
})
