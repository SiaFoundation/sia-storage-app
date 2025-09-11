import { View, StyleSheet } from 'react-native'
import { ArrowDownToLineIcon } from 'lucide-react-native'
import { FileStatus } from '../lib/file'

export function CacheStatusIcon({
  status,
  size = 16,
}: {
  status: FileStatus
  size?: number
}) {
  if (status.cachedUri) {
    return (
      <View style={styles.badge}>
        <ArrowDownToLineIcon color="#0f6bff" size={size} />
      </View>
    )
  }

  return null
}

const styles = StyleSheet.create({
  badge: {
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderColor: '#d0d7de',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
})
