import { HeartIcon, TagIcon } from 'lucide-react-native'
import { useMemo } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SYSTEM_TAGS, type TagWithCount, useAllTags } from '../stores/tags'
import { overlay, palette, whiteA } from '../styles/colors'
import { EmptyState } from './EmptyState'

type TagOrSpacer = TagWithCount | { id: '__spacer' }

type Props = {
  onSelectTag: (tagId: string, tagName: string) => void
  onCreateTag: () => void
}

export function TagsGrid({ onSelectTag, onCreateTag }: Props) {
  const allTags = useAllTags()
  const tags = allTags.data ?? []

  const paddedTags: TagOrSpacer[] = useMemo(
    () => (tags.length % 2 === 1 ? [...tags, { id: '__spacer' }] : tags),
    [tags],
  )

  if (!allTags.data) {
    return (
      <View style={styles.emptyWrap}>
        <ActivityIndicator color={palette.blue[400]} />
      </View>
    )
  }

  if (tags.length === 0) {
    return (
      <EmptyState
        image={require('../../assets/tag-stack.png')}
        title="No tags yet"
        message="Create tags to organize your files."
        action={{ label: 'Create tag', onPress: onCreateTag }}
      />
    )
  }

  return (
    <FlatList
      data={paddedTags}
      keyExtractor={(tag) => tag.id}
      numColumns={2}
      contentContainerStyle={styles.grid}
      columnWrapperStyle={styles.row}
      showsVerticalScrollIndicator={false}
      renderItem={({ item }) =>
        item.id === '__spacer' ? (
          <View style={styles.spacer} />
        ) : (
          <TagCard
            tag={item as TagWithCount}
            onPress={() => onSelectTag(item.id, (item as TagWithCount).name)}
          />
        )
      }
    />
  )
}

function TagCard({ tag, onPress }: { tag: TagWithCount; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      {tag.id === SYSTEM_TAGS.favorites.id ? (
        <HeartIcon color={palette.red[500]} fill={palette.red[500]} size={24} />
      ) : (
        <TagIcon color={palette.blue[400]} size={24} />
      )}
      <View style={styles.cardText}>
        <Text style={styles.tagName} numberOfLines={1}>
          {tag.name}
        </Text>
        <Text style={styles.tagCount}>
          {tag.fileCount.toLocaleString()}{' '}
          {tag.fileCount === 1 ? 'file' : 'files'}
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
  row: {
    gap: 12,
    marginBottom: 12,
  },
  spacer: {
    flex: 1,
  },
  card: {
    flex: 1,
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
  tagName: {
    color: palette.gray[50],
    fontSize: 16,
    fontWeight: '700',
  },
  tagCount: {
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
