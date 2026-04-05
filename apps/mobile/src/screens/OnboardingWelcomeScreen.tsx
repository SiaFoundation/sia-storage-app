import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useEffect, useRef } from 'react'
import { Animated, Easing, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import BlocksGrid from '../components/BlocksGrid'
import { SHAPES } from '../components/BlocksShape'
import { Button } from '../components/Button'
import type { OnboardingStackParamList } from '../stacks/types'
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

  const gridOpacity = useRef(new Animated.Value(1)).current
  const contentOpacity = useRef(new Animated.Value(0)).current

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

      <Animated.View
        style={[styles.contentWrap, { opacity: contentOpacity, paddingTop: top + 12 }]}
      >
        <View style={styles.card}>
          <View style={styles.center}>
            <Text testID="welcome-title" style={styles.title}>
              Sia Storage
            </Text>
            <Text style={styles.subtitle}>The world's safest cloud storage, by design.</Text>
          </View>
        </View>
      </Animated.View>

      <Animated.View
        style={[styles.footer, { opacity: contentOpacity, paddingBottom: bottom + 12 }]}
      >
        <Button
          testID="welcome-get-started-button"
          style={styles.footerButton}
          onPress={() => nav.navigate('ChooseIndexer')}
        >
          Get Started
        </Button>
      </Animated.View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },

  contentWrap: {
    flex: 1,
    alignItems: 'stretch',
    justifyContent: 'center',
  },

  card: {
    width: '100%',
    paddingHorizontal: 20,
    paddingVertical: 32,
    backgroundColor: '#000',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: palette.gray[800],
  },

  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },

  title: {
    color: 'white',
    fontSize: 32,
    fontWeight: '800',
    textAlign: 'center',
  },

  subtitle: {
    color: palette.gray[400],
    fontSize: 16,
    textAlign: 'center',
    marginTop: 10,
  },

  footer: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 20,
  },

  footerButton: { flex: 1 },
})
