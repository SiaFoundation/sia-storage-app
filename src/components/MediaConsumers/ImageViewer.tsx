import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ScrollView,
  Image,
  ViewStyle,
  View,
  LayoutChangeEvent,
  StyleSheet,
} from 'react-native'

export function ImageViewer({
  uri,
  style,
}: {
  uri: string
  style?: ViewStyle
}) {
  const scrollRef = useRef<ScrollView>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout
    setSize({ w: width, h: height })
  }

  const reset = () => {
    scrollRef.current?.scrollResponderZoomTo({
      x: 0,
      y: 0,
      width: size.w || 1,
      height: size.h || 1,
      animated: false,
    })
  }

  useEffect(() => {
    if (size.w && size.h) reset()
  }, [uri, size.w, size.h])

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
