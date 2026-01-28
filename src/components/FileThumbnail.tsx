import {
  FileAudioIcon,
  FileIcon,
  FileJsonIcon,
  FileTextIcon,
  ImageIcon,
  PlayIcon,
} from 'lucide-react-native'
import { Image, StyleSheet, View } from 'react-native'
import { useBestThumbnailUri } from '../hooks/useBestThumbnail'
import type { FileRecord, ThumbSize } from '../stores/files'
import { palette } from '../styles/colors'

export function FileThumbnail({
  file,
  thumbSize,
  iconSize = 16,
  iconColor = palette.gray[200],
}: {
  file: FileRecord
  thumbSize: ThumbSize
  iconSize?: number
  iconColor?: string
}) {
  const bestThumb = useBestThumbnailUri(file, thumbSize)

  if (file.type?.includes('image')) {
    const thumbUri = bestThumb.data
    if (thumbUri) {
      return <Image source={{ uri: thumbUri }} style={styles.thumbnailImage} />
    }
    return (
      <View style={styles.thumbnailImage}>
        <ImageIcon size={iconSize} color={iconColor} />
      </View>
    )
  }
  if (file.type?.includes('pdf')) {
    return (
      <View style={styles.thumbnailImage}>
        <FileTextIcon size={iconSize} color={iconColor} />
      </View>
    )
  }
  if (file.type?.includes('video')) {
    const thumbUri = bestThumb.data
    return (
      <View style={styles.thumbnailImage}>
        {thumbUri ? (
          <Image
            source={{ uri: thumbUri }}
            style={[{ position: 'absolute' }, styles.thumbnailImage]}
          />
        ) : null}
        <PlayIcon size={iconSize} color={iconColor} />
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
