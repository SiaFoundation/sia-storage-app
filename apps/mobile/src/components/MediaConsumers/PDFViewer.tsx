import { StyleSheet, useWindowDimensions, View, type ViewStyle } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Pdf from 'react-native-pdf'
import Animated, { runOnJS } from 'react-native-reanimated'
import { blackA } from '../../styles/colors'

const EDGE_ZONE_WIDTH = 40
const SWIPE_THRESHOLD = 50

type Props = {
  source: string
  style?: ViewStyle
  onSwipeLeft?: () => void
  onSwipeRight?: () => void
}

export function PDFViewer({ source, style, onSwipeLeft, onSwipeRight }: Props) {
  const { width: screenWidth } = useWindowDimensions()

  // Left edge: swipe right to go to previous file
  const leftEdgeGesture = Gesture.Pan()
    .onEnd((event) => {
      if (event.translationX > SWIPE_THRESHOLD && onSwipeRight) {
        runOnJS(onSwipeRight)()
      }
    })
    .activeOffsetX(15)
    .failOffsetY([-15, 15])

  // Right edge: swipe left to go to next file
  const rightEdgeGesture = Gesture.Pan()
    .onEnd((event) => {
      if (event.translationX < -SWIPE_THRESHOLD && onSwipeLeft) {
        runOnJS(onSwipeLeft)()
      }
    })
    .activeOffsetX(-15)
    .failOffsetY([-15, 15])

  return (
    <View style={[styles.container, style]}>
      <Pdf
        fitPolicy={2}
        maxScale={8}
        minScale={1}
        source={{ uri: source }}
        style={styles.pdf}
        trustAllCerts={false}
        enableAntialiasing
      />
      {/* Left edge swipe zone */}
      <GestureDetector gesture={leftEdgeGesture}>
        <Animated.View style={[styles.edgeZone, styles.leftEdge]} />
      </GestureDetector>
      {/* Right edge swipe zone */}
      <GestureDetector gesture={rightEdgeGesture}>
        <Animated.View
          style={[styles.edgeZone, styles.rightEdge, { left: screenWidth - EDGE_ZONE_WIDTH }]}
        />
      </GestureDetector>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  pdf: { flex: 1, backgroundColor: blackA.a20 },
  edgeZone: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: EDGE_ZONE_WIDTH,
  },
  leftEdge: {
    left: 0,
  },
  rightEdge: {
    // left is set dynamically based on screen width
  },
})
