import { View, StyleSheet } from 'react-native'
import UploadStatusIcon, { type UploadStatus } from './UploadStatusIcon'

export default function PhotoStatusBadge({
  status,
  size = 18,
}: {
  status: UploadStatus
  size?: number
}) {
  return (
    <View style={styles.badge} pointerEvents="none">
      <UploadStatusIcon status={status} size={size} />
    </View>
  )
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderColor: '#d0d7de',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
})
