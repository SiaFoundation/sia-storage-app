import { useAllTags } from '@siastorage/core/stores'
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
import { useToast } from '../lib/toastContext'
import { useFocusOnShow } from '../lib/useFocusOnShow'
import { app } from '../stores/appService'
import { useSelectedFileIds } from '../stores/fileSelection'
import { closeSheet, useSheetOpen } from '../stores/sheets'
import { palette, whiteA } from '../styles/colors'
import { ModalSheet } from './ModalSheet'
import { SpinnerIcon } from './SpinnerIcon'

type Props = {
  sheetName?: string
  fileIds?: string[]
  onComplete?: () => void
}

export function BulkManageTagsSheet({
  sheetName = 'bulkManageTags',
  fileIds: fileIdsProp,
  onComplete,
}: Props) {
  const toast = useToast()
  const isOpen = useSheetOpen(sheetName)
  const selectedFileIds = useSelectedFileIds()
  const fileIds = fileIdsProp ?? Array.from(selectedFileIds)
  const fileCount = fileIds.length
  const allTags = useAllTags()
  const [query, setQuery] = useState('')
  const inputRef = useRef<TextInput | null>(null)
  const [addedTagIds, setAddedTagIds] = useState<Set<string>>(new Set())
  const [loadingTagNames, setLoadingTagNames] = useState<Set<string>>(new Set())

  const allTagList = (allTags.data ?? []).filter((t) => !t.system)

  const filtered = query.trim()
    ? allTagList.filter((t) =>
        t.name.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : allTagList

  const exactMatch =
    query.trim().length > 0 &&
    allTagList.some((t) => t.name.toLowerCase() === query.trim().toLowerCase())

  const handleShow = useFocusOnShow(inputRef)

  useEffect(() => {
    if (!isOpen) {
      setQuery('')
      setAddedTagIds(new Set())
      setLoadingTagNames(new Set())
    }
  }, [isOpen])

  const handleAddTag = useCallback(
    async (tagName: string) => {
      const trimmed = tagName.trim()
      if (!trimmed) return
      const key = trimmed.toLowerCase()
      setLoadingTagNames((prev) => new Set([...prev, key]))
      try {
        await app().tags.addToFiles(fileIds, trimmed)
        toast.show(
          `Added "${trimmed}" to ${fileCount} ${fileCount === 1 ? 'file' : 'files'}`,
        )
        const tag = allTagList.find((t) => t.name.toLowerCase() === key)
        if (tag) {
          setAddedTagIds((prev) => new Set([...prev, tag.id]))
        }
        setQuery('')
      } finally {
        setLoadingTagNames((prev) => {
          const next = new Set(prev)
          next.delete(key)
          return next
        })
      }
    },
    [fileIds, fileCount, allTagList, toast],
  )

  const handleClose = useCallback(() => {
    const hasChanges = addedTagIds.size > 0
    setQuery('')
    Keyboard.dismiss()
    closeSheet()
    if (hasChanges) onComplete?.()
  }, [addedTagIds.size, onComplete])

  return (
    <ModalSheet
      visible={isOpen}
      onRequestClose={handleClose}
      onShow={handleShow}
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
          query.trim().length > 0 && !exactMatch
            ? (() => {
                const isCreating = loadingTagNames.has(
                  query.trim().toLowerCase(),
                )
                return (
                  <Pressable
                    style={styles.tagRow}
                    onPress={() => handleAddTag(query.trim())}
                    disabled={isCreating}
                  >
                    <View style={styles.tagRowLeft}>
                      {isCreating ? (
                        <SpinnerIcon size={16} color={palette.blue[400]} />
                      ) : (
                        <PlusIcon size={16} color={palette.blue[400]} />
                      )}
                      <Text style={styles.createText}>
                        Create "{query.trim()}"
                      </Text>
                    </View>
                  </Pressable>
                )
              })()
            : null
        }
        renderItem={({ item }) => {
          const isLoading = loadingTagNames.has(item.name.toLowerCase())
          const justAdded = addedTagIds.has(item.id)
          return (
            <Pressable
              style={styles.tagRow}
              onPress={() => handleAddTag(item.name)}
              disabled={isLoading}
            >
              <View style={styles.tagRowLeft}>
                <Text style={styles.tagName}>{item.name}</Text>
              </View>
              {isLoading ? (
                <SpinnerIcon size={18} color={palette.blue[400]} />
              ) : justAdded ? (
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
