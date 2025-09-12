import { View, StyleSheet } from 'react-native'
import {
  CloudAlertIcon,
  CloudCheckIcon,
  CloudDownloadIcon,
  XIcon,
} from 'lucide-react-native'
import { FileStatus } from '../lib/file'
import { SpinnerIcon } from './SpinnerIcon'

export function UploadStatusIcon({
  status,
  size = 16,
}: {
  status: FileStatus
  size?: number
}) {
  if (status.isErrored) {
    return (
      <View style={styles.badge}>
        <XIcon color="#cf222e" size={size} />
      </View>
    )
  }

  if (status.isUploading) {
    return (
      <View style={styles.badge}>
        <SpinnerIcon size={size} />
      </View>
    )
  }

  if (status.isUploaded) {
    if (status.isDownloaded) {
      return (
        <View style={styles.badge}>
          <CloudCheckIcon color="#57606a" size={size} />
        </View>
      )
    }
    return (
      <View style={styles.badge}>
        <CloudDownloadIcon color="#57606a" size={size} />
      </View>
    )
  }

  return (
    <View style={styles.badge}>
      <CloudAlertIcon color="#57606a" size={size} />
    </View>
  )

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
