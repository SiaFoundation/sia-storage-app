import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
  Easing,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { blackA, palette } from '../styles/colors'

type Props = {
  visible: boolean
  onRequestClose: () => void
  children: React.ReactNode
  contentStyle?: StyleProp<ViewStyle>
  backdropOpacity?: number
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable)

export function ActionSheet({
  visible,
  onRequestClose,
  children,
  contentStyle,
  backdropOpacity = 0.35,
}: Props) {
  const insets = useSafeAreaInsets()

  const [mounted, setMounted] = useState<boolean>(visible)
  const [sheetHeight, setSheetHeight] = useState<number>(0)
  const progress = useRef(new Animated.Value(0)).current

  const openSpringConfig = useMemo(
    () => ({
      toValue: 1,
      damping: 80,
      stiffness: 900,
      mass: 0.9,
      velocity: 2,
      useNativeDriver: true,
    }),
    []
  )

  const closeTimingConfig = useMemo(
    () => ({
      toValue: 0,
      duration: 140,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }),
    []
  )

  useEffect(() => {
    if (visible) {
      if (!mounted) {
        setMounted(true)
        progress.setValue(0)
        return
      }
      if (sheetHeight > 0) {
        Animated.spring(progress, openSpringConfig).start()
      }
    } else if (mounted) {
      Animated.timing(progress, closeTimingConfig).start(({ finished }) => {
        if (finished) setMounted(false)
      })
    }
  }, [
    visible,
    mounted,
    sheetHeight,
    progress,
    openSpringConfig,
    closeTimingConfig,
  ])

  if (!mounted) return null

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      onRequestClose={onRequestClose}
    >
      <View style={styles.root}>
        <AnimatedPressable
          accessibilityRole="button"
          onPress={onRequestClose}
          style={[
            styles.backdrop,
            {
              opacity: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [0, backdropOpacity],
              }),
            },
          ]}
        />
        <Animated.View
          onLayout={(e) => {
            const h = e.nativeEvent.layout.height
            if (h > 0 && h !== sheetHeight) setSheetHeight(h)
          }}
          style={[
            styles.sheet,
            { paddingBottom: Math.max(16, insets.bottom + 12) },
            sheetHeight === 0
              ? { opacity: 0 }
              : {
                  transform: [
                    {
                      translateY: progress.interpolate({
                        inputRange: [0, 1],
                        outputRange: [
                          sheetHeight + Math.max(16, insets.bottom + 12),
                          0,
                        ],
                        extrapolate: 'clamp',
                      }),
                    },
                  ],
                },
            contentStyle,
          ]}
        >
          {children}
        </Animated.View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: blackA.a100,
  },
  sheet: {
    backgroundColor: 'white',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    shadowColor: palette.gray[950],
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 6,
  },
})

export default ActionSheet
