import { CheckIcon, FolderIcon, PlusIcon, XIcon } from 'lucide-react-native'
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
import { useFocusOnShow } from '../lib/useFocusOnShow'
import { createDirectory, useAllDirectories } from '../stores/directories'
import { closeSheet, useSheetOpen } from '../stores/sheets'
import { palette, whiteA } from '../styles/colors'
import { ModalSheet } from './ModalSheet'

type Props = {
  sheetName?: string
  currentValue: string
  onSelect: (name: string) => void
  onClear: () => void
}

export function SelectDirectorySheet({
  sheetName = 'selectDirectory',
  currentValue,
  onSelect,
  onClear,
}: Props) {
  const isOpen = useSheetOpen(sheetName)
  const allDirs = useAllDirectories()
  const [query, setQuery] = useState('')
  const inputRef = useRef<TextInput | null>(null)

  const dirs = allDirs.data ?? []
  const filtered = query.trim()
    ? dirs.filter((d) =>
        d.name.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : dirs

  const exactMatch =
    query.trim().length > 0 &&
    dirs.some((d) => d.name.toLowerCase() === query.trim().toLowerCase())

  const handleShow = useFocusOnShow(inputRef)

  useEffect(() => {
    if (!isOpen) {
      setQuery('')
    }
  }, [isOpen])

  const handleSelect = useCallback(
    (name: string) => {
      onSelect(name)
      Keyboard.dismiss()
      closeSheet()
    },
    [onSelect],
  )

  const handleClear = useCallback(() => {
    onClear()
    Keyboard.dismiss()
    closeSheet()
  }, [onClear])

  const handleCreateAndSelect = useCallback(
    async (name: string) => {
      const trimmed = name.trim()
      if (!trimmed) return
      try {
        const dir = await createDirectory(trimmed)
        handleSelect(dir.name)
      } catch {
        const existing = dirs.find(
          (d) => d.name.toLowerCase() === trimmed.toLowerCase(),
        )
        if (existing) {
          handleSelect(existing.name)
        }
      }
    },
    [dirs, handleSelect],
  )

  const handleClose = useCallback(() => {
    setQuery('')
    Keyboard.dismiss()
    closeSheet()
  }, [])

  return (
    <ModalSheet
      visible={isOpen}
      onRequestClose={handleClose}
      onShow={handleShow}
      title="Import folder"
      headerRight={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          onPress={handleClose}
          hitSlop={8}
        >
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      }
    >
      <View style={styles.inputRow}>
        <TextInput
          ref={inputRef}
          style={styles.input}
          placeholder="Search or create folder..."
          placeholderTextColor={palette.gray[500]}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={() => {
            if (query.trim()) handleCreateAndSelect(query.trim())
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
          <>
            <Pressable style={styles.dirRow} onPress={handleClear}>
              <View style={styles.dirRowLeft}>
                <XIcon size={18} color={palette.gray[400]} />
                <Text style={styles.removeText}>No folder</Text>
              </View>
              {currentValue === '' && (
                <CheckIcon size={18} color={palette.blue[400]} />
              )}
            </Pressable>
            {query.trim().length > 0 && !exactMatch ? (
              <Pressable
                style={styles.dirRow}
                onPress={() => handleCreateAndSelect(query.trim())}
              >
                <View style={styles.dirRowLeft}>
                  <PlusIcon size={16} color={palette.blue[400]} />
                  <Text style={styles.createText}>Create "{query.trim()}"</Text>
                </View>
              </Pressable>
            ) : null}
          </>
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.dirRow}
            onPress={() => handleSelect(item.name)}
          >
            <View style={styles.dirRowLeft}>
              <FolderIcon size={18} color={palette.blue[400]} />
              <Text style={styles.dirName}>{item.name}</Text>
              <Text style={styles.dirCount}>{item.fileCount}</Text>
            </View>
            {item.name.toLowerCase() === currentValue.toLowerCase() && (
              <CheckIcon size={18} color={palette.blue[400]} />
            )}
          </Pressable>
        )}
        ListEmptyComponent={
          query.trim().length === 0 ? (
            <Text style={styles.emptyText}>
              No folders yet. Type to create one.
            </Text>
          ) : null
        }
      />
    </ModalSheet>
  )
}

const styles = StyleSheet.create({
  cancelText: {
    color: palette.blue[400],
    fontSize: 17,
    fontWeight: '600',
  },
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
  dirRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: whiteA.a08,
  },
  dirRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  dirName: {
    color: palette.gray[50],
    fontSize: 16,
  },
  dirCount: {
    color: whiteA.a50,
    fontSize: 14,
  },
  removeText: {
    color: palette.gray[400],
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
