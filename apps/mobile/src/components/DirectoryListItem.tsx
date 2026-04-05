import type { DirectoryWithCount } from '@siastorage/core/db/operations'
import { ChevronRightIcon, FolderIcon } from 'lucide-react-native'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { palette, whiteA } from '../styles/colors'

type Props = {
  dir: DirectoryWithCount
  onPress: () => void
}

export function DirectoryListItem({ dir, onPress }: Props) {
  const metaParts: string[] = []
  metaParts.push(`${dir.fileCount.toLocaleString()} ${dir.fileCount === 1 ? 'file' : 'files'}`)
  if (dir.subdirectoryCount > 0) {
    metaParts.push(`${dir.subdirectoryCount} ${dir.subdirectoryCount === 1 ? 'folder' : 'folders'}`)
  }

  return (
    <Pressable
      style={({ pressed }) => [styles.container, pressed && styles.pressed]}
      onPress={onPress}
    >
      <View style={styles.iconContainer}>
        <FolderIcon color={palette.blue[400]} size={20} />
      </View>
      <View style={styles.infoContainer}>
        <View style={styles.details}>
          <Text style={styles.name} numberOfLines={1} ellipsizeMode="tail">
            {dir.name}
          </Text>
          <Text style={styles.meta}>{metaParts.join(', ')}</Text>
        </View>
      </View>
      <View style={styles.trailing}>
        <ChevronRightIcon color={whiteA.a20} size={16} />
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  container: {
    display: 'flex',
    flexDirection: 'row',
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: whiteA.a10,
    paddingVertical: 8,
    paddingLeft: 16,
    paddingRight: 24,
    overflow: 'hidden',
  },
  pressed: {
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  iconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
    borderRadius: 4,
  },
  infoContainer: {
    flexGrow: 1,
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'center',
    overflow: 'hidden',
  },
  details: {
    display: 'flex',
    gap: 2,
    justifyContent: 'center',
    overflow: 'hidden',
    flex: 1,
  },
  name: {
    fontSize: 14,
    fontWeight: '600',
    color: palette.gray[50],
    overflow: 'hidden',
  },
  meta: {
    fontSize: 10,
    color: 'gray',
  },
  trailing: {
    paddingLeft: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
