import type { DirectoryWithCount } from '@siastorage/core/db/operations'
import { UNFILED_DIRECTORY_ID } from '@siastorage/core/db/operations'
import { useAllDirectories, useUnfiledFileCount } from '@siastorage/core/stores'
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
import { overlay, palette, whiteA } from '../styles/colors'
import { EmptyState } from './EmptyState'

type Props = {
  onSelectDirectory: (directoryId: string, directoryName: string) => void
  onCreateDirectory: () => void
}

export function DirectoriesGrid({
  onSelectDirectory,
  onCreateDirectory,
}: Props) {
  const allDirs = useAllDirectories()
  const unfiledCount = useUnfiledFileCount()
  const dirs = allDirs.data ?? []

  const listData = useMemo(() => {
    const items: DirectoryWithCount[] = [...dirs]
    if ((unfiledCount.data ?? 0) > 0) {
      items.push({
        id: UNFILED_DIRECTORY_ID,
        path: 'No folder',
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
      <EmptyState
        image={require('../../assets/folder-stack.png')}
        title="No folders yet"
        message="Create folders to organize your files."
        action={{ label: 'Create folder', onPress: onCreateDirectory }}
      />
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
          onPress={() => onSelectDirectory(item.id, item.path)}
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
          {dir.path}
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
})
