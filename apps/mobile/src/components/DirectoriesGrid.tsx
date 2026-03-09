import { FolderIcon, InboxIcon } from 'lucide-react-native'
import { useMemo } from 'react'
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
  UNFILED_DIRECTORY_ID,
  useAllDirectories,
} from '../stores/directories'
import { useUnfiledFileCount } from '../stores/library'
import { overlay, palette, whiteA } from '../styles/colors'

type Props = {
  onSelectDirectory: (directoryId: string, directoryName: string) => void
}

export function DirectoriesGrid({ onSelectDirectory }: Props) {
  const allDirs = useAllDirectories()
  const unfiledCount = useUnfiledFileCount()
  const dirs = allDirs.data ?? []

  const listData = useMemo(() => {
    const items: DirectoryWithCount[] = [...dirs]
    if ((unfiledCount.data ?? 0) > 0) {
      items.push({
        id: UNFILED_DIRECTORY_ID,
        name: 'No folder',
        createdAt: 0,
        fileCount: unfiledCount.data ?? 0,
      })
    }
    return items
  }, [dirs, unfiledCount.data])

  if (!allDirs.data) {
    return (
      <View style={styles.emptyWrap}>
        <ActivityIndicator color={palette.blue[400]} />
      </View>
    )
  }

  if (listData.length === 0) {
    return (
      <View style={styles.emptyWrap}>
        <FolderIcon color={whiteA.a50} size={48} />
        <Text style={styles.emptyTitle}>No folders yet</Text>
        <Text style={styles.emptyText}>
          Create folders to organize your files.
        </Text>
      </View>
    )
  }

  return (
    <FlatList
      data={listData}
      keyExtractor={(dir) => dir.id}
      contentContainerStyle={styles.grid}
      showsVerticalScrollIndicator={false}
      renderItem={({ item }) => (
        <DirectoryCard
          dir={item}
          onPress={() => onSelectDirectory(item.id, item.name)}
          isUnfiled={item.id === UNFILED_DIRECTORY_ID}
        />
      )}
    />
  )
}

function DirectoryCard({
  dir,
  onPress,
  isUnfiled = false,
}: {
  dir: DirectoryWithCount
  onPress: () => void
  isUnfiled?: boolean
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      {isUnfiled ? (
        <InboxIcon color={palette.gray[400]} size={24} />
      ) : (
        <FolderIcon color={palette.blue[400]} size={24} />
      )}
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
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
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
