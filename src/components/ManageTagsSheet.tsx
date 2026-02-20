import { CheckIcon, PlusIcon } from 'lucide-react-native'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { closeSheet, useSheetOpen } from '../stores/sheets'
import {
  addTagToFile,
  removeTagFromFile,
  useAllTags,
  useTagsForFile,
} from '../stores/tags'
import { palette, whiteA } from '../styles/colors'
import { ModalSheet } from './ModalSheet'
import { TagPill } from './TagPill'

type Props = {
  fileId: string
  sheetName: string
}

export function ManageTagsSheet({ fileId, sheetName }: Props) {
  const isOpen = useSheetOpen(sheetName)
  const fileTags = useTagsForFile(fileId)
  const allTags = useAllTags()
  const [query, setQuery] = useState('')
  const inputRef = useRef<TextInput | null>(null)

  const existingTagIds = new Set((fileTags.data ?? []).map((t) => t.id))
  const userFileTags = (fileTags.data ?? []).filter((t) => !t.system)
  const allTagList = (allTags.data ?? []).filter((t) => !t.system)

  const filtered = query.trim()
    ? allTagList.filter((t) =>
        t.name.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : allTagList

  const exactMatch =
    query.trim().length > 0 &&
    allTagList.some((t) => t.name.toLowerCase() === query.trim().toLowerCase())

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 400)
    } else {
      setQuery('')
    }
  }, [isOpen])

  const handleAddTag = useCallback(
    async (tagName: string) => {
      if (!tagName.trim()) return
      await addTagToFile(fileId, tagName.trim())
      setQuery('')
    },
    [fileId],
  )

  const handleRemoveTag = useCallback(
    async (tagId: string) => {
      await removeTagFromFile(fileId, tagId)
    },
    [fileId],
  )

  const handleClose = useCallback(() => {
    setQuery('')
    Keyboard.dismiss()
    closeSheet()
  }, [])

  const handleToggleTag = useCallback(
    (tag: { id: string; name: string }) => {
      if (existingTagIds.has(tag.id)) {
        handleRemoveTag(tag.id)
      } else {
        handleAddTag(tag.name)
      }
    },
    [existingTagIds, handleAddTag, handleRemoveTag],
  )

  return (
    <ModalSheet visible={isOpen} onRequestClose={handleClose} title="Tags">
      <View style={styles.inputRow}>
        {userFileTags.map((tag) => (
          <TagPill
            key={tag.id}
            tag={tag}
            selected
            onRemove={() => handleRemoveTag(tag.id)}
          />
        ))}
        <TextInput
          ref={inputRef}
          style={styles.input}
          placeholder={
            userFileTags.length > 0 ? 'Add more...' : 'Search or create tag...'
          }
          placeholderTextColor={palette.gray[500]}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={() => {
            if (query.trim()) handleAddTag(query.trim())
          }}
        />
      </View>
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          query.trim().length > 0 && !exactMatch ? (
            <Pressable
              style={styles.tagRow}
              onPress={() => handleAddTag(query.trim())}
            >
              <View style={styles.tagRowLeft}>
                <PlusIcon size={16} color={palette.blue[400]} />
                <Text style={styles.createText}>Create "{query.trim()}"</Text>
              </View>
            </Pressable>
          ) : null
        }
        renderItem={({ item }) => {
          const isOnFile = existingTagIds.has(item.id)
          return (
            <Pressable
              style={styles.tagRow}
              onPress={() => handleToggleTag(item)}
            >
              <View style={styles.tagRowLeft}>
                <Text style={styles.tagName}>{item.name}</Text>
                {'fileCount' in item ? (
                  <Text style={styles.tagCount}>
                    {(item as { fileCount: number }).fileCount}
                  </Text>
                ) : null}
              </View>
              {isOnFile ? (
                <CheckIcon size={18} color={palette.blue[400]} />
              ) : null}
            </Pressable>
          )
        }}
        ListEmptyComponent={
          query.trim().length > 0 && exactMatch ? null : query.trim().length ===
            0 ? (
            <Text style={styles.emptyText}>
              No tags yet. Type to create one.
            </Text>
          ) : null
        }
      />
    </ModalSheet>
  )
}

const styles = StyleSheet.create({
  inputRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: whiteA.a10,
  },
  input: {
    flex: 1,
    minWidth: 120,
    color: palette.gray[50],
    fontSize: 16,
    paddingVertical: 4,
  },
  listContent: {
    paddingBottom: 40,
  },
  tagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: whiteA.a08,
  },
  tagRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  tagName: {
    color: palette.gray[50],
    fontSize: 16,
  },
  tagCount: {
    color: whiteA.a50,
    fontSize: 14,
  },
  createText: {
    color: palette.blue[400],
    fontSize: 16,
    fontWeight: '500',
  },
  emptyText: {
    color: whiteA.a50,
    fontSize: 15,
    textAlign: 'center',
    paddingTop: 40,
  },
})
