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
import { useSelectedFileIds } from '../stores/fileSelection'
import { closeSheet, useSheetOpen } from '../stores/sheets'
import { addTagToFile, useAllTags } from '../stores/tags'
import { palette, whiteA } from '../styles/colors'
import { ModalSheet } from './ModalSheet'

export function BulkManageTagsSheet() {
  const isOpen = useSheetOpen('bulkManageTags')
  const selectedFileIds = useSelectedFileIds()
  const allTags = useAllTags()
  const [query, setQuery] = useState('')
  const inputRef = useRef<TextInput | null>(null)
  const [addedTagIds, setAddedTagIds] = useState<Set<string>>(new Set())

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
      setAddedTagIds(new Set())
    }
  }, [isOpen])

  const handleAddTag = useCallback(
    async (tagName: string) => {
      if (!tagName.trim()) return
      const fileIds = Array.from(selectedFileIds)
      for (const fileId of fileIds) {
        await addTagToFile(fileId, tagName.trim())
      }
      const tag = allTagList.find(
        (t) => t.name.toLowerCase() === tagName.trim().toLowerCase(),
      )
      if (tag) {
        setAddedTagIds((prev) => new Set([...prev, tag.id]))
      }
      setQuery('')
    },
    [selectedFileIds, allTagList],
  )

  const handleClose = useCallback(() => {
    setQuery('')
    Keyboard.dismiss()
    closeSheet()
  }, [])

  const fileCount = selectedFileIds.size

  return (
    <ModalSheet
      visible={isOpen}
      onRequestClose={handleClose}
      title={`Add ${fileCount} ${fileCount === 1 ? 'file' : 'files'} to tag`}
    >
      <View style={styles.inputRow}>
        <TextInput
          ref={inputRef}
          style={styles.input}
          placeholder="Search or create tag..."
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
          const justAdded = addedTagIds.has(item.id)
          return (
            <Pressable
              style={styles.tagRow}
              onPress={() => handleAddTag(item.name)}
            >
              <View style={styles.tagRowLeft}>
                <Text style={styles.tagName}>{item.name}</Text>
              </View>
              {justAdded ? (
                <CheckIcon size={18} color={palette.blue[400]} />
              ) : null}
            </Pressable>
          )
        }}
        ListEmptyComponent={
          query.trim().length === 0 ? (
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
