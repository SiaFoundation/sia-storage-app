import { useDownloadEntry } from '@siastorage/core/stores'
import { CloudDownloadIcon } from 'lucide-react-native'
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { colors, palette } from '../../styles/colors'

type DownloadPromptProps = {
  fileId: string
  hasMissingMetadata: boolean
  onDownloadPress: () => void
  isDownloading: boolean
}

export function DownloadPrompt({
  fileId,
  hasMissingMetadata,
  onDownloadPress,
  isDownloading,
}: DownloadPromptProps) {
  const { data: downloadState } = useDownloadEntry(fileId)

  if (isDownloading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator color={colors.accentPrimary} size="large" />
        <Text style={styles.downloadText}>
          Downloading: {((downloadState?.progress || 0) * 100).toFixed(0)}%
        </Text>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <CloudDownloadIcon color={colors.textPrimary} size={40} />
      <Text style={styles.downloadText}>
        {hasMissingMetadata
          ? 'Press to download and compute required metadata'
          : 'Press to download'}
      </Text>
      <TouchableOpacity style={styles.downloadButton} onPress={onDownloadPress}>
        <Text style={styles.downloadButtonText}>Download</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.bgPanel,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
  },
  downloadText: {
    color: colors.textPrimary,
    textAlign: 'center',
    width: '80%',
    maxWidth: 500,
  },
  downloadButton: {
    height: 36,
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: palette.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  downloadButtonText: {
    color: palette.gray[900],
    fontWeight: '600',
    fontSize: 16,
  },
})
