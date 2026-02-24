import { useEffect, useRef, useState } from 'react'
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import BlocksGrid from '../components/BlocksGrid'
import BlocksShape from '../components/BlocksShape'
import { Button } from '../components/Button'
import { initApp } from '../managers/app'
import { setHasOnboarded } from '../stores/settings'
import { palette } from '../styles/colors'

export default function OnboardingFinishedScreen() {
  const { height: screenHeight } = useWindowDimensions()
  const { top, bottom } = useSafeAreaInsets()
  const gridHeight = Math.round(screenHeight * 2.2)
  const translateY = useRef(new Animated.Value(0)).current
  const fadeInValue = useRef(new Animated.Value(0)).current
  const [reduceMotion, setReduceMotion] = useState(false)

  useEffect(() => {
    let sub: { remove: () => void } | undefined
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion)
    sub = AccessibilityInfo.addEventListener?.(
      'reduceMotionChanged',
      setReduceMotion,
    )
    return () => {
      sub?.remove?.()
    }
  }, [])

  useEffect(() => {
    const travel = gridHeight - screenHeight
    if (travel <= 0 || reduceMotion) {
      translateY.setValue(0)
      return
    }

    const speedPxPerSec = 8
    const durationMs = Math.max(1, Math.round((travel / speedPxPerSec) * 1000))

    translateY.setValue(-travel)

    const anim = Animated.timing(translateY, {
      toValue: 0,
      duration: durationMs,
      easing: Easing.linear,
      useNativeDriver: true,
    })

    anim.start()
    return () => {
      translateY.stopAnimation()
    }
  }, [gridHeight, screenHeight, translateY, reduceMotion])

  useEffect(() => {
    if (reduceMotion) {
      fadeInValue.setValue(1)
      return
    }
    fadeInValue.setValue(0)
    const anim = Animated.timing(fadeInValue, {
      toValue: 1,
      duration: 700,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    })
    anim.start()
    return () => {
      anim.stop()
    }
  }, [fadeInValue, reduceMotion])

  return (
    <SafeAreaView style={styles.screen}>
      <View style={StyleSheet.absoluteFill}>
        <Animated.View
          style={[
            StyleSheet.absoluteFillObject,
            { transform: [{ translateY }] },
          ]}
          pointerEvents="none"
        >
          <BlocksGrid
            cols={5}
            rows={24}
            tileScale={0.12}
            animation="none"
            opacity={0.14}
            inset={{ top, bottom }}
            style={{ height: gridHeight }}
          />
        </Animated.View>
      </View>

      <View
        style={[
          styles.content,
          { paddingTop: top + 24, paddingBottom: bottom + 24 },
        ]}
      >
        <View style={styles.card}>
          <View style={styles.titleRow}>
            <View style={styles.titleIcon}>
              <BlocksShape
                shape="line3"
                tileSize={12}
                origin={{ x: 0, y: 0 }}
                style={styles.titleIconGlyph}
                rotation={90}
              />
            </View>
            <Animated.Text
              testID="finished-title"
              style={[styles.title, { opacity: fadeInValue }]}
            >
              All set!
            </Animated.Text>
          </View>

          <Text style={styles.subtitle}>
            You are connected and ready to use Sia Storage.
          </Text>
          <Text style={styles.subtitle}>
            Manage your recovery phrase and provider anytime in Settings via the
            icon on the top right of the home screen.
          </Text>
        </View>
      </View>

      <View style={[styles.footer, { paddingBottom: bottom }]}>
        <Button
          testID="finished-upload-button"
          variant="primary"
          onPress={async () => {
            await setHasOnboarded(true)
            await initApp()
          }}
        >
          Upload files
        </Button>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  content: {
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
  titleIcon: {
    width: 36,
    height: 12,
    position: 'relative',
  },
  titleIconGlyph: {
    width: 36,
    height: 12,
  },
  title: {
    color: 'white',
    fontSize: 28,
    fontWeight: '800',
  },
  subtitle: {
    color: palette.gray[300],
    fontSize: 14,
  },
  statusList: {
    gap: 12,
    paddingTop: 8,
  },
  statusItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: palette.blue[400],
  },
  statusText: {
    color: palette.gray[200],
    fontSize: 13,
  },
  footer: {
    paddingHorizontal: 20,
  },
})
