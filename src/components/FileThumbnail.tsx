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

  if (status.data?.isDownloading) {
    return (
      <View style={styles.thumbnailImage}>
        <CenteredProgress status={status.data} size={iconSize} />
      </View>
    )
  }

  if (file.type?.includes('image')) {
    if (status.data?.fileUri) {
      return (
        <Image
          source={{ uri: status.data?.fileUri }}
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
  if (file.type?.includes('pdf')) {
    if (status.data?.fileUri) {
      return (
        <Image
          source={{ uri: status.data?.fileUri }}
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
  if (file.type?.includes('video')) {
    return (
      <View style={styles.thumbnailImage}>
        <FileVideoIcon size={iconSize} color={iconColor} />
      </View>
    )
  }
  if (file.type?.includes('application/pdf')) {
    return (
      <View style={styles.thumbnailImage}>
        <FileTextIcon size={iconSize} color={iconColor} />
      </View>
    )
  }
  if (file.type?.includes('audio')) {
    return (
      <View style={styles.thumbnailImage}>
        <FileAudioIcon size={iconSize} color={iconColor} />
      </View>
    )
  }
  if (
    file.type?.includes('text/plain') ||
    file.type?.includes('text/markdown') ||
    file.name?.toLowerCase().includes('.md')
  ) {
    return (
      <View style={styles.thumbnailImage}>
        <FileTextIcon size={iconSize} color={iconColor} />
      </View>
    )
  }
  if (
    file.type?.includes('application/json') ||
    file.name?.toLowerCase().includes('.json')
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
