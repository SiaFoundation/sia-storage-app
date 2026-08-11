import { useEffect, useRef, useState } from 'react'
import { Animated, StyleSheet } from 'react-native'
import { noteUserActivity, useScreenDimmed } from '../managers/screenDim'

const OVERLAY_OPACITY = 0.5
const FADE_MS = 400

/**
 * Black layer over the app while screenDim holds the panel at 1%. It swallows
 * the wake tap, so a control under a barely legible UI cannot be hit by it.
 * It outlives the dim state by one fade so the exit animation has something
 * to run against.
 */
export function DimOverlay() {
  const dimmed = useScreenDimmed()
  const [visible, setVisible] = useState(dimmed)
  const opacity = useRef(new Animated.Value(dimmed ? OVERLAY_OPACITY : 0)).current

  useEffect(() => {
    if (dimmed) setVisible(true)
    const fade = Animated.timing(opacity, {
      toValue: dimmed ? OVERLAY_OPACITY : 0,
      duration: FADE_MS,
      useNativeDriver: true,
    })
    fade.start(({ finished }) => {
      if (finished && !dimmed) setVisible(false)
    })
    return () => fade.stop()
  }, [dimmed, opacity])

  if (!visible) return null

  return (
    <Animated.View
      testID="screen-dim"
      style={[StyleSheet.absoluteFill, styles.overlay, { opacity }]}
      pointerEvents={dimmed ? 'auto' : 'none'}
      onStartShouldSetResponder={() => true}
      onResponderGrant={noteUserActivity}
    />
  )
}

const styles = StyleSheet.create({
  overlay: { backgroundColor: '#000' },
})
