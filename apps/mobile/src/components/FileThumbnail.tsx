import type { FileRecord, ThumbSize } from '@siastorage/core/types'
import { Image } from 'expo-image'
import {
  FileAudioIcon,
  FileIcon,
  FileJsonIcon,
  FileTextIcon,
  ImageIcon,
  PlayIcon,
} from 'lucide-react-native'
import { StyleSheet, View } from 'react-native'
import { useThumbnailUri } from '../hooks/useBestThumbnail'
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
  // Real cached thumb when present, else the device photo-library tile while
  // importing. onError fires only for the OS fallback, which marks the asset
  // unrenderable so the cell drops to the icon and stops retrying.
  const { uri, isOsFallback, onOsError } = useThumbnailUri(file, thumbSize)

  if (file.type?.includes('image')) {
    if (uri) {
      return (
        <Image
          source={uri}
          style={styles.thumbnailImage}
          recyclingKey={file.id}
          onError={isOsFallback ? onOsError : undefined}
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
    return (
      <View style={styles.thumbnailImage}>
        <FileTextIcon size={iconSize} color={iconColor} />
      </View>
    )
  }
  if (file.type?.includes('video')) {
    return (
      <View style={styles.thumbnailImage}>
        {uri ? (
          <Image
            source={uri}
            style={[{ position: 'absolute' }, styles.thumbnailImage]}
            recyclingKey={file.id}
            onError={isOsFallback ? onOsError : undefined}
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
  if (file.type?.includes('application/json') || file.name?.toLowerCase().includes('.json')) {
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
