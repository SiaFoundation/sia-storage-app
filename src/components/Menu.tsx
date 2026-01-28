import type React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Animated,
  Pressable,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native'
import { overlay, palette } from '../styles/colors'

type Props = {
  isOpen: boolean
  onClose: () => void
  anchorRef?: React.RefObject<View | null>
  children: React.ReactNode
  contentStyle?: StyleProp<ViewStyle>
}

export function Menu({
  isOpen,
  onClose,
  anchorRef,
  children,
  contentStyle,
}: Props) {
  const [mounted, setMounted] = useState<boolean>(isOpen)
  const [position, setPosition] = useState<{ top: number; right: number }>({
    top: 56,
    right: 8,
  })
  const opacity = useRef(new Animated.Value(0)).current
  const scale = useRef(new Animated.Value(0.98)).current

  const openTiming = useMemo(
    () => ({ toValue: 1, duration: 140, useNativeDriver: true }),
    [],
  )
  const closeTiming = useMemo(
    () => ({ toValue: 0, duration: 120, useNativeDriver: true }),
    [],
  )

  useEffect(() => {
    if (isOpen) {
      if (!mounted) {
        setMounted(true)
        opacity.setValue(0)
        scale.setValue(0.98)
        return
      }
      Animated.timing(opacity, openTiming).start()
      Animated.timing(scale, openTiming).start()
    } else if (mounted) {
      Animated.timing(opacity, closeTiming).start(({ finished }) => {
        if (finished) setMounted(false)
      })
      Animated.timing(scale, closeTiming).start()
    }
  }, [isOpen, mounted, opacity, scale, openTiming, closeTiming])

  useEffect(() => {
    if (!isOpen) return
    const ref = anchorRef?.current
    if (ref && typeof ref.measureInWindow === 'function') {
      ref.measureInWindow((_x: number, y: number, width: number) => {
        // Position menu aligned to the right of the anchor.
        setPosition({ top: y + (width ? 32 : 24), right: Math.max(8, 8) })
      })
    }
  }, [isOpen, anchorRef])

  if (!mounted) return null

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <Animated.View
        style={[
          StyleSheet.absoluteFillObject,
          {
            opacity: opacity.interpolate({
              inputRange: [0, 1],
              outputRange: [0, 0.15],
            }),
          },
        ]}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          onPress={onClose}
        />
      </Animated.View>
      <Animated.View
        style={[
          styles.menu,
          {
            top: position.top,
            right: position.right,
            opacity,
            transform: [{ scale }],
          },
          contentStyle,
        ]}
      >
        {children}
      </Animated.View>
    </View>
  )
}

export function MenuItem({
  icon,
  children,
  onPress,
}: {
  icon?: React.ReactNode
  children: React.ReactNode
  onPress: () => void
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.item}>
      {icon}
      <View style={{ width: 10 }} />
      <Animated.Text style={styles.itemText}>{children}</Animated.Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  menu: {
    position: 'absolute',
    minWidth: 240,
    backgroundColor: overlay.menu,
    borderRadius: 14,
    paddingVertical: 6,
    paddingHorizontal: 10,
    shadowColor: palette.gray[950],
    shadowOpacity: 0.2,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 20,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 6,
  },
  itemText: {
    color: 'white',
    fontSize: 16,
  },
})
