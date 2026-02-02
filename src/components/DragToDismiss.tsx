import { createContext, type ReactNode, useContext } from 'react'
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native'
import {
  Gesture,
  GestureDetector,
  type GestureType,
} from 'react-native-gesture-handler'
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated'

type Props = {
  children: ReactNode
  onDismiss: () => void
  onDragStart?: () => void
  enabled?: boolean
  dismissThreshold?: number
}

const DragToDismissGestureContext = createContext<GestureType | null>(null)

export function useDragToDismissGesture() {
  return useContext(DragToDismissGestureContext)
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
  const startX = useSharedValue(0)
  const startY = useSharedValue(0)
  const isActivated = useSharedValue(false)

  const panGesture = Gesture.Pan()
    .enabled(enabled)
    .manualActivation(true)
    .onTouchesDown((event) => {
      const touch = event.allTouches[0]
      if (touch) {
        startX.value = touch.absoluteX
        startY.value = touch.absoluteY
        isActivated.value = false
      }
    })
    .onTouchesMove((event, stateManager) => {
      if (isActivated.value) return

      const touch = event.allTouches[0]
      if (!touch) return

      const dx = touch.absoluteX - startX.value
      const dy = touch.absoluteY - startY.value
      const absX = Math.abs(dx)
      const absY = Math.abs(dy)

      const threshold = 10

      if (absX > threshold || absY > threshold) {
        if (absY > absX && dy > 0) {
          // Vertical downward movement - activate for dismiss
          isActivated.value = true
          stateManager.activate()
        } else {
          // Horizontal or upward movement - fail to allow carousel/children
          stateManager.fail()
        }
      }
    })
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
      'clamp',
    )
    const borderRadius = interpolate(
      translateY.value,
      [0, 50],
      [0, 24],
      'clamp',
    )
    return {
      transform: [{ translateY: translateY.value }, { scale }],
      borderRadius,
      overflow: 'hidden' as const,
    }
  })

  // On Android, wrap content with a native gesture to allow children to receive touches
  const nativeGesture = Gesture.Native()
  const composedGesture =
    Platform.OS === 'android'
      ? Gesture.Simultaneous(panGesture, nativeGesture)
      : panGesture

  return (
    <DragToDismissGestureContext.Provider value={panGesture}>
      <View style={styles.container}>
        <Animated.View style={[styles.backdrop, backdropStyle]} />
        <GestureDetector gesture={composedGesture}>
          <Animated.View style={[styles.content, contentStyle]}>
            {children}
          </Animated.View>
        </GestureDetector>
      </View>
    </DragToDismissGestureContext.Provider>
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
