import { View, StyleSheet } from 'react-native'
import Svg, { Circle } from 'react-native-svg'

type Props = {
  progress: number // 0..1
  size?: number
  strokeWidth?: number
  trackColor?: string
  progressColor?: string
}

export function CircularProgress({
  progress,
  size = 36,
  strokeWidth = 3,
  trackColor = '#e5e7eb',
  progressColor = '#0969da',
}: Props) {
  const clamped = Math.max(0, Math.min(1, progress))
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - clamped)

  return (
    <View
      style={[
        styles.container,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
    >
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={trackColor}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={progressColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={offset}
          fill="none"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderColor: '#d0d7de',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
})
