import { View, StyleSheet } from 'react-native'
import { type FileRecord } from '../db/files'
import { useFileStatus } from '../lib/file'
import { StatusBadges } from './StatusBadges'
import { useEffect } from 'react'

type Props = {
  file: FileRecord
  size?: number
}

export function FileIndicators({ file, size = 16 }: Props) {
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
      <StatusBadges status={status} size={size} />
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
