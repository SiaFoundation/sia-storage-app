import { Image, StyleSheet, View } from 'react-native'
import { FileRecord } from '../stores/files'
import { useFileStatus } from '../lib/file'
import {
  FileAudioIcon,
  FileIcon,
  FileJsonIcon,
  FileTextIcon,
  FileVideoIcon,
  ImageIcon,
} from 'lucide-react-native'
import { palette } from '../styles/colors'
import {
  thumbnailShouldAutoDownload,
  useAutoDownload,
} from '../hooks/useAutoDownload'
import { CenteredProgress } from './CenteredProgress'

export function FileThumbnail({
  file,
  iconSize = 16,
  iconColor = palette.gray[200],
}: {
  file: FileRecord
  iconSize?: number
  iconColor?: string
}) {
  const status = useFileStatus(file)
  useAutoDownload(file, thumbnailShouldAutoDownload)

  if (status.isDownloading) {
    return (
      <View style={styles.thumbnailImage}>
        <CenteredProgress status={status} size={iconSize} />
      </View>
    )
  }

  if (file.fileType?.includes('image')) {
    if (status.cachedUri) {
      return (
        <Image
          source={{ uri: status.cachedUri }}
          style={styles.thumbnailImage}
        />
      )
    }
    return (
      <View style={styles.thumbnailImage}>
        <ImageIcon size={iconSize} color={iconColor} />
      </View>
    )
  }
  if (file.fileType?.includes('pdf')) {
    if (status.cachedUri) {
      return (
        <Image
          source={{ uri: status.cachedUri }}
          style={styles.thumbnailImage}
        />
      )
    }
    return (
      <View style={styles.thumbnailImage}>
        <FileTextIcon size={iconSize} color={iconColor} />
      </View>
    )
  }
  if (file.fileType?.includes('video')) {
    return (
      <View style={styles.thumbnailImage}>
        <FileVideoIcon size={iconSize} color={iconColor} />
      </View>
    )
  }
  if (file.fileType?.includes('application/pdf')) {
    return (
      <View style={styles.thumbnailImage}>
        <FileTextIcon size={iconSize} color={iconColor} />
      </View>
    )
  }
  if (file.fileType?.includes('audio')) {
    return (
      <View style={styles.thumbnailImage}>
        <FileAudioIcon size={iconSize} color={iconColor} />
      </View>
    )
  }
  if (
    file.fileType?.includes('text/plain') ||
    file.fileType?.includes('text/markdown') ||
    file.fileName?.toLowerCase().includes('.md')
  ) {
    return (
      <View style={styles.thumbnailImage}>
        <FileTextIcon size={iconSize} color={iconColor} />
      </View>
    )
  }
  if (
    file.fileType?.includes('application/json') ||
    file.fileName?.toLowerCase().includes('.json')
  ) {
    return (
      <View style={styles.thumbnailImage}>
        <FileJsonIcon size={iconSize} color={iconColor} />
      </View>
    )
  }
  return (
    <View style={styles.thumbnailImage}>
      <FileIcon size={iconSize} color={iconColor} />
    </View>
  )
}

const styles = StyleSheet.create({
  thumbnailImage: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
    backgroundColor: palette.gray[900],
  },
})
