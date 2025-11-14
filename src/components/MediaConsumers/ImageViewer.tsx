import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from 'react'
import {
  ScrollView,
  Image,
  ViewStyle,
  View,
  LayoutChangeEvent,
  StyleSheet,
  Platform,
} from 'react-native'

export type ImageViewerHandle = {
  resetZoom: () => void
}

type Props = {
  uri: string
  style?: ViewStyle
  ref?: Ref<ImageViewerHandle>
}

export function ImageViewer({ uri, style, ref }: Props) {
  const scrollRef = useRef<ScrollView>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout
    setSize({ w: width, h: height })
  }

  const reset = useCallback(() => {
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
  }, [size.w, size.h])

  useImperativeHandle(
    ref,
    () => ({
      resetZoom: () => {
        reset()
      },
    }),
    [reset]
  )

  useEffect(() => {
    if (size.w && size.h) reset()
  }, [reset, uri])

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
