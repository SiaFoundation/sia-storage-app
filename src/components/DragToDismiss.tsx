import React, { ReactNode } from 'react'
import { StyleSheet, useWindowDimensions, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
  interpolate,
} from 'react-native-reanimated'

type Props = {
  children: ReactNode
  onDismiss: () => void
  onDragStart?: () => void
  enabled?: boolean
  dismissThreshold?: number
}

export function DragToDismiss({
  children,
  onDismiss,
  onDragStart,
  enabled = true,
  dismissThreshold = 150,
}: Props) {
  const { height: screenHeight } = useWindowDimensions()
  const translateY = useSharedValue(0)
  const hasFiredDragStart = useSharedValue(false)

  const panGesture = Gesture.Pan()
    .enabled(enabled)
    .activeOffsetY([10, 10])
    .failOffsetX([-10, 10])
    .onStart(() => {
      hasFiredDragStart.value = false
    })
    .onUpdate((event) => {
      if (event.translationY > 0) {
        if (!hasFiredDragStart.value && onDragStart) {
          hasFiredDragStart.value = true
          runOnJS(onDragStart)()
        }
        translateY.value = event.translationY
      }
    })
    .onEnd((event) => {
      if (event.translationY > dismissThreshold) {
        translateY.value = withSpring(screenHeight, { damping: 20 })
        runOnJS(onDismiss)()
      } else {
        translateY.value = withSpring(0)
      }
    })

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateY.value, [0, screenHeight * 0.5], [1, 0]),
  }))

  const contentStyle = useAnimatedStyle(() => {
    const scale = interpolate(
      translateY.value,
      [0, dismissThreshold],
      [1, 0.75],
      'clamp'
    )
    const borderRadius = interpolate(
      translateY.value,
      [0, 50],
      [0, 24],
      'clamp'
    )
    return {
      transform: [{ translateY: translateY.value }, { scale }],
      borderRadius,
      overflow: 'hidden' as const,
    }
  })

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.backdrop, backdropStyle]} />
      <GestureDetector gesture={panGesture}>
        <Animated.View style={[styles.content, contentStyle]}>
          {children}
        </Animated.View>
      </GestureDetector>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
  },
  content: {
    flex: 1,
  },
})
