import { View, StyleSheet } from 'react-native'
import { whiteA, palette } from '../styles/colors'
import { useFileStatus } from '../lib/file'
import { StatusBadges } from './StatusBadges'
import { LocalObject } from '../encoding/localObject'

type Props = {
  file: {
    id: string
    fileType: string | null
    objects: Record<string, LocalObject> | null
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
    backgroundColor: whiteA.a20,
  },
  thumbProgressFill: {
    height: '100%',
    backgroundColor: palette.green[500],
  },
})
