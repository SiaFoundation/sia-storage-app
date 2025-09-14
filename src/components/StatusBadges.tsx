import { View, StyleSheet } from 'react-native'
import { UploadStatusIcon } from './UploadStatusIcon'
import { FileStatus } from '../lib/file'

export function StatusBadges({
  status,
  size = 10,
  interactive = false,
}: {
  status: FileStatus
  size?: number
  interactive?: boolean
}) {
  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <UploadStatusIcon
          status={status}
          size={size}
          interactive={interactive}
        />
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
    pointerEvents: 'box-none',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
})
