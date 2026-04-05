import { memo, useEffect, useRef } from 'react'
import { Animated, Easing, View } from 'react-native'
import Svg, { Circle } from 'react-native-svg'
import { palette } from '../styles/colors'

type Props = {
  size?: number
  color?: string
  arcLength?: number // 0..1 of circumference to show.
}

export const SpinnerIcon = memo(SpinnerIconInner)

function SpinnerIconInner({ size = 14, color = palette.gray[300], arcLength = 0.5 }: Props) {
  const clampedArc = Math.max(0.1, Math.min(0.95, arcLength))
  const rotation = useRef(new Animated.Value(0)).current

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(rotation, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    )
    loop.start()
    return () => {
      loop.stop()
      rotation.stopAnimation()
    }
  }, [rotation])

  const spin = rotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  })

  const radius = (size * 0.75) / 2
  const circumference = 2 * Math.PI * radius
  const dash = circumference * clampedArc

  return (
    <View style={{ width: size, height: size }}>
      <Animated.View style={{ transform: [{ rotate: spin }] }}>
        <Svg width={size} height={size}>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={color}
            opacity={0.8}
            strokeWidth={size * 0.05}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference}`}
            fill="none"
          />
        </Svg>
      </Animated.View>
    </View>
  )
}
