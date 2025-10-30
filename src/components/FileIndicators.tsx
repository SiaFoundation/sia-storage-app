import { View, StyleSheet } from 'react-native'
import { whiteA, palette } from '../styles/colors'
import { useFileStatus } from '../lib/file'
import { StatusBadges } from './StatusBadges'
import { FileRecord } from '../stores/files'

type Props = {
  file: FileRecord
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
      {status.data?.isUploading ? (
        <View style={styles.thumbProgressTrack}>
          <View
            style={[
              styles.thumbProgressFill,
              { width: `${Math.round(status.data?.uploadProgress * 100)}%` },
            ]}
          />
        </View>
      ) : null}
      {status.data ? (
        <StatusBadges
          status={status.data}
          size={size}
          interactive={interactive}
        />
      ) : null}
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
    backgroundColor: whiteA.a20,
  },
  thumbProgressFill: {
    height: '100%',
    backgroundColor: palette.green[500],
  },
})
