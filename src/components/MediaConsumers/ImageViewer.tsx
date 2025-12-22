import { useEffect, useRef, useState } from 'react'
import {
  ScrollView,
  Image,
  ViewStyle,
  View,
  LayoutChangeEvent,
  StyleSheet,
  Platform,
} from 'react-native'

export function ImageViewer({
  uri,
  style,
  onZoomChange,
}: {
  uri: string
  style?: ViewStyle
  onZoomChange?: (isZoomed: boolean) => void
}) {
  const scrollRef = useRef<ScrollView>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [currentZoom, setCurrentZoom] = useState(1)

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout
    setSize({ w: width, h: height })
  }

  const reset = () => {
    if (Platform.OS === 'ios') {
      scrollRef.current?.scrollResponderZoomTo({
        x: 0,
        y: 0,
        width: size.w || 1,
        height: size.h || 1,
        animated: false,
      })
    } else {
      // Android does not implement zoomToRect; reset scroll position instead.
      scrollRef.current?.scrollTo({ x: 0, y: 0, animated: false })
    }
  }

  useEffect(() => {
    if (size.w && size.h) {
      reset()
      setCurrentZoom(1) // Reset zoom state when image changes
    }
  }, [uri, size.w, size.h])

  // Notify parent when zoom state changes
  useEffect(() => {
    if (onZoomChange) {
      onZoomChange(currentZoom > 1)
    }
  }, [currentZoom, onZoomChange])

  const handleScroll = (event: any) => {
    const zoom = event.nativeEvent.zoomScale
    if (zoom !== undefined && zoom !== currentZoom) {
      setCurrentZoom(zoom)
    }
  }

  return (
    <View style={[styles.wrap, style]} onLayout={onLayout}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{
          width: size.w,
          height: size.h,
          justifyContent: 'center',
          alignItems: 'center',
        }}
        minimumZoomScale={1}
        maximumZoomScale={4}
        bounces={false}
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
      >
        <Image
          source={{ uri }}
          style={{ width: '100%', height: '100%', resizeMode: 'contain' }}
        />
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
})
