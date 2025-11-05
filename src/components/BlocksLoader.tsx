import React, { useEffect, useMemo, useRef } from 'react'
import { Animated, Easing, StyleSheet, View, ViewStyle } from 'react-native'
import BlocksShape, { BLOCK_COLORS } from './BlocksShape'

type Props = {
  size?: number
  colorStart?: number
  style?: ViewStyle
  accessibilityLabel?: string
}

export default function BlocksLoader({
  size = 16,
  colorStart = 0,
  style,
  accessibilityLabel = 'Connecting',
}: Props) {
  const t = useRef(new Animated.Value(0)).current

  useEffect(() => {
    t.setValue(0)
    const loop = Animated.loop(
      Animated.timing(t, {
        toValue: 3,
        duration: 2600,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    )
    loop.start()
    return () => t.stopAnimation()
  }, [t])

  const colors = useMemo(
    () =>
      [0, 1, 2].map(
        (i) => BLOCK_COLORS[(colorStart + i) % BLOCK_COLORS.length]
      ),
    [colorStart]
  )

  const base = 0.25
  const peak = 1
  const shoulder = 1.2
  const plateauHalf = 0.2

  const bump = (center: number) =>
    t.interpolate({
      inputRange: [
        center - shoulder,
        center - plateauHalf,
        center + plateauHalf,
        center + shoulder,
      ],
      outputRange: [base, peak, peak, base],
      extrapolate: 'clamp',
    })

  const opacities = [0, 1, 2].map((i) => {
    const a = bump(i)
    const b = bump(i + 3)
    const sum = Animated.add(a, Animated.add(b, -base))
    return sum.interpolate({
      inputRange: [base, 2 * peak - base],
      outputRange: [base, peak],
      extrapolate: 'clamp',
    })
  })

  const frameW = size * 3
  const frameH = size

  return (
    <View
      style={[styles.frame, { width: frameW, height: frameH }, style]}
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      pointerEvents="none"
    >
      {opacities.map((opacity, i) => (
        <Animated.View key={i} style={{ opacity }}>
          <BlocksShape
            shape="block1"
            origin={{ x: i * size, y: 0 }}
            tileSize={size}
            palette={[colors[i]]}
            ringStart={0}
          />
        </Animated.View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  frame: { position: 'relative' },
})
