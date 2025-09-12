import { View, StyleSheet } from 'react-native'
import { UploadStatusIcon } from './UploadStatusIcon'
import { FileStatus } from '../lib/file'

export function StatusBadges({
  status,
  size = 10,
}: {
  status: FileStatus
  size?: number
}) {
  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <UploadStatusIcon status={status} size={size} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    zIndex: 2,
    pointerEvents: 'none',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
})
