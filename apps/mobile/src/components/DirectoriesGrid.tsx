import { FolderIcon } from 'lucide-react-native'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import {
  type DirectoryWithCount,
  useAllDirectories,
} from '../stores/directories'
import { overlay, palette, whiteA } from '../styles/colors'

type Props = {
  onSelectDirectory: (directoryId: string, directoryName: string) => void
}

export function DirectoriesGrid({ onSelectDirectory }: Props) {
  const allDirs = useAllDirectories()
  const dirs = allDirs.data ?? []

  if (!allDirs.data) {
    return (
      <View style={styles.emptyWrap}>
        <ActivityIndicator color={palette.blue[400]} />
      </View>
    )
  }

  if (dirs.length === 0) {
    return (
      <View style={styles.emptyWrap}>
        <FolderIcon color={whiteA.a50} size={48} />
        <Text style={styles.emptyTitle}>No directories yet</Text>
        <Text style={styles.emptyText}>
          Create directories to organize your files.
        </Text>
      </View>
    )
  }

  return (
    <FlatList
      data={dirs}
      keyExtractor={(dir) => dir.id}
      contentContainerStyle={styles.grid}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      renderItem={({ item }) => (
        <DirectoryCard
          dir={item}
          onPress={() => onSelectDirectory(item.id, item.name)}
        />
      )}
    />
  )
}

function DirectoryCard({
  dir,
  onPress,
}: {
  dir: DirectoryWithCount
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <FolderIcon color={palette.blue[400]} size={24} />
      <View style={styles.cardText}>
        <Text style={styles.dirName} numberOfLines={1}>
          {dir.name}
        </Text>
        <Text style={styles.dirCount}>
          {dir.fileCount.toLocaleString()}{' '}
          {dir.fileCount === 1 ? 'file' : 'files'}
        </Text>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  grid: {
    padding: 16,
    paddingTop: 140,
    paddingBottom: 120,
  },
  separator: {
    height: 12,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: overlay.panelMedium,
    borderRadius: 16,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: whiteA.a10,
    gap: 12,
  },
  cardPressed: {
    backgroundColor: overlay.panelStrong,
  },
  cardText: {
    flex: 1,
  },
  dirName: {
    color: palette.gray[50],
    fontSize: 16,
    fontWeight: '700',
  },
  dirCount: {
    color: whiteA.a50,
    fontSize: 13,
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  emptyTitle: {
    color: palette.gray[100],
    fontWeight: '800',
    fontSize: 18,
    paddingTop: 12,
    paddingBottom: 6,
  },
  emptyText: {
    color: whiteA.a70,
    textAlign: 'center',
  },
})
