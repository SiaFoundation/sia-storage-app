import { useCallback, useRef } from 'react'
import { ViewStyle, StyleSheet } from 'react-native'
import { ImageZoom, ImageZoomRef } from '@likashefqet/react-native-image-zoom'

export function ImageViewer({
  uri,
  style,
  onZoomChange,
}: {
  uri: string
  style?: ViewStyle
  onZoomChange?: (isZoomed: boolean) => void
}) {
  const zoomRef = useRef<ImageZoomRef>(null)
  const isZoomedRef = useRef(false)

  // Called when user starts pinching or panning while zoomed
  const handleInteractionStart = useCallback(() => {
    if (!isZoomedRef.current) {
      isZoomedRef.current = true
      onZoomChange?.(true)
    }
  }, [onZoomChange])

  // Called when zoom resets back to scale 1
  const handleResetAnimationEnd = useCallback(() => {
    if (isZoomedRef.current) {
      isZoomedRef.current = false
      onZoomChange?.(false)
    }
  }, [onZoomChange])

  return (
    <ImageZoom
      ref={zoomRef}
      uri={uri}
      style={[styles.image, style]}
      minScale={1}
      maxScale={4}
      doubleTapScale={2}
      isDoubleTapEnabled
      isSingleTapEnabled={false}
      onInteractionStart={handleInteractionStart}
      onResetAnimationEnd={handleResetAnimationEnd}
      resizeMode="contain"
    />
  )
}

const styles = StyleSheet.create({
  image: { flex: 1 },
})
