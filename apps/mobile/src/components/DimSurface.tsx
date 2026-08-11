/**
 * A surface the idle dim covers: it notes every touch on its content as
 * activity and draws the dim overlay over it.
 *
 * The app's root is one. A native modal, a React Native `Modal` or a
 * native-stack modal screen, sits above everything the root draws, so a root
 * overlay cannot cover it and a wake tap on a dimmed sheet would land on the
 * control under it, such as Stop on the archive import. So each modal surface
 * wraps its content in one of these too.
 */
import type { ReactNode } from 'react'
import { StyleSheet, View, type ViewStyle } from 'react-native'
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
import { noteUserActivity } from '../managers/screenDim'
import { DimOverlay } from './DimOverlay'

export function DimSurface({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return (
    // Capture phase to see a touch before a child claims the responder;
    // returning false means it never claims one itself.
    <GestureHandlerRootView
      style={[styles.fill, style]}
      onStartShouldSetResponderCapture={captureActivity}
    >
      <GestureDetector gesture={activityGesture}>
        <View style={styles.fill} collapsable={false}>
          {children}
        </View>
      </GestureDetector>
      <DimOverlay />
    </GestureHandlerRootView>
  )
}

function captureActivity(): boolean {
  noteUserActivity()
  return false
}

// Gesture-handler gestures, such as the carousel's swipe and a pinch to zoom,
// can run without the responder capture above seeing their touches, and an
// unseen swipe would let the screen dim mid-use. This gesture never
// activates, so it notes the touch and leaves it to whatever claims it.
const activityGesture = Gesture.Manual()
  .manualActivation(true)
  .runOnJS(true)
  .onTouchesDown(() => noteUserActivity())

const styles = StyleSheet.create({
  fill: { flex: 1 },
})
