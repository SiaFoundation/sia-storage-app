import { CircularProgress } from './CircularProgress'
import { FileStatus } from '../lib/file'
import { View, StyleSheet } from 'react-native'

export function CenteredProgress({
  status,
  size = 44,
}: {
  status: FileStatus
  size?: number
}) {
  return (
    <View style={styles.container}>
      <CircularProgress progress={status.downloadProgress ?? 0} size={size} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    zIndex: 2,
  },
})
