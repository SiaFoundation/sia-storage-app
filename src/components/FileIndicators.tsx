import { View, StyleSheet } from 'react-native'
import { whiteA, palette } from '../styles/colors'
import { useFileStatus } from '../lib/file'
import { StatusBadges } from './StatusBadges'
import { SealedObject } from 'react-native-sia'

type Props = {
  file: {
    id: string
    fileType: string | null
    sealedObjects: Record<string, SealedObject> | null
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
