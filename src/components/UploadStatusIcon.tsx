import { useEffect, useMemo, useRef } from 'react'
import { Animated, Easing, View } from 'react-native'
import { CloudIcon, Loader2Icon, XIcon } from 'lucide-react-native'

export type UploadStatus = 'uploading' | 'done' | 'error'

export function UploadStatusIcon({
  status,
  size = 16,
}: {
  status: UploadStatus
  size?: number
}) {
  const rotateValue = useRef(new Animated.Value(0)).current
  const spinInterpolation = useMemo(
    () =>
      rotateValue.interpolate({
        inputRange: [0, 1],
        outputRange: ['0deg', '360deg'],
      }),
    [rotateValue]
  )

  useEffect(() => {
    if (status !== 'uploading') {
      // Stop any running animation when not uploading.
      rotateValue.stopAnimation()
      rotateValue.setValue(0)
      return
    }

    // Ensure continuous loop that survives re-renders.
    rotateValue.setValue(0)
    const loop = Animated.loop(
      Animated.timing(rotateValue, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: true,
        isInteraction: false,
      })
    )
    loop.start()
    return () => {
      loop.stop()
    }
  }, [status, rotateValue])

  if (status === 'error') {
    return <XIcon color="#cf222e" size={size} />
  }

  if (status === 'uploading') {
    return (
      <Animated.View
        style={{
          transform: [{ rotate: spinInterpolation }],
        }}
      >
        <Loader2Icon color="#57606a" size={size} />
      </Animated.View>
    )
  }

  return (
    <View>
      <CloudIcon color="#57606a" size={size} />
    </View>
  )
}

export default UploadStatusIcon
