import { View, StyleSheet } from 'react-native'
import { type FileRecord } from '../stores/files'
import { useFileStatus } from '../lib/file'
import { StatusBadges } from './StatusBadges'
import { PinnedObject } from 'react-native-sia'

type Props = {
  file: {
    id: string
    fileType: string | null
    pinnedObjects: unknown
  }
  size?: number
  interactive?: boolean
}

export function FileIndicators({
  file,
  size = 16,
  interactive = false,
}: Props) {
  const status = useFileStatus(file)
  return (
    <>
      {status.isUploading ? (
        <View style={styles.thumbProgressTrack}>
          <View
            style={[
              styles.thumbProgressFill,
              { width: `${Math.round(status.uploadProgress * 100)}%` },
            ]}
          />
        </View>
      ) : null}
      <StatusBadges status={status} size={size} interactive={interactive} />
    </>
  )
}

const styles = StyleSheet.create({
  thumbProgressTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.7)',
  },
  thumbProgressFill: {
    height: '100%',
    backgroundColor: '#22c55e',
  },
})
