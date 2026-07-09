import { StyleSheet, View } from 'react-native'
import { palette } from '../styles/colors'

type Props = {
  /** Fill fraction, 0..1. Clamped. */
  ratio: number
}

export function ImportProgressBar({ ratio }: Props) {
  const clamped = Math.max(0, Math.min(1, ratio))
  return (
    <View style={styles.track}>
      <View style={[styles.fill, { width: `${(clamped * 100).toFixed(1)}%` as `${number}%` }]} />
    </View>
  )
}

const styles = StyleSheet.create({
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.gray[800],
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: palette.blue[400],
  },
})
