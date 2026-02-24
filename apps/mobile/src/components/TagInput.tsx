import { PlusIcon } from 'lucide-react-native'
import type React from 'react'
import { useCallback, useState } from 'react'
import {
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { addTagToFile, type Tag, useTagSearch } from '../stores/tags'
import { colors, overlay, palette, whiteA } from '../styles/colors'

type TagInputProps = {
  fileId: string
  existingTagIds: Set<string>
  onTagAdded?: () => void
}

export function TagInput({
  fileId,
  existingTagIds,
  onTagAdded,
}: TagInputProps): React.ReactElement {
  const [query, setQuery] = useState('')
  const searchResults = useTagSearch(query.trim())

  const filteredResults = (searchResults.data ?? []).filter(
    (tag) => !existingTagIds.has(tag.id),
  )

  const showSuggestions = query.trim().length > 0

  const exactMatch = filteredResults.some(
    (tag) => tag.name.toLowerCase() === query.trim().toLowerCase(),
  )

  const handleAddTag = useCallback(
    async (tagName: string) => {
      if (!tagName.trim()) return
      await addTagToFile(fileId, tagName.trim())
      setQuery('')
      Keyboard.dismiss()
      onTagAdded?.()
    },
    [fileId, onTagAdded],
  )

  const handleSelectTag = useCallback(
    (tag: Tag) => {
      handleAddTag(tag.name)
    },
    [handleAddTag],
  )

  const handleCreateNew = useCallback(() => {
    handleAddTag(query.trim())
  }, [query, handleAddTag])

  return (
    <View>
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          placeholder="Add tag..."
          placeholderTextColor={palette.gray[400]}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={() => {
            if (query.trim()) {
              handleAddTag(query.trim())
            }
          }}
        />
      </View>
      {showSuggestions && (
        <View style={styles.suggestions}>
          {filteredResults.map((tag) => (
            <Pressable
              key={tag.id}
              style={styles.suggestionItem}
              onPress={() => handleSelectTag(tag)}
            >
              <Text style={styles.suggestionText}>{tag.name}</Text>
            </Pressable>
          ))}
          {query.trim() && !exactMatch ? (
            <Pressable style={styles.createNewItem} onPress={handleCreateNew}>
              <PlusIcon size={14} color={palette.blue[400]} />
              <Text style={styles.createNewText}>Create "{query.trim()}"</Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  inputContainer: {
    backgroundColor: overlay.panelMedium,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: whiteA.a10,
  },
  input: {
    color: colors.textPrimary,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  suggestions: {
    marginTop: 4,
    backgroundColor: palette.gray[900],
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: whiteA.a10,
    overflow: 'hidden',
  },
  suggestionItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: whiteA.a10,
  },
  suggestionText: {
    color: colors.textPrimary,
    fontSize: 14,
  },
  createNewItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  createNewText: {
    color: palette.blue[400],
    fontSize: 14,
    fontWeight: '500',
  },
})
