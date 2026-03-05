import { FolderIcon, FoldersIcon, PlusIcon, XIcon } from 'lucide-react-native'
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
import {
  countFilesWithDirectories,
  createDirectory,
  moveFilesToDirectory,
  moveFileToDirectory,
  readDirectoryNameForFile,
  useAllDirectories,
} from '../stores/directories'
import { closeSheet, useSheetOpen } from '../stores/sheets'
import { palette, whiteA } from '../styles/colors'
import { ModalSheet } from './ModalSheet'
import { SpinnerIcon } from './SpinnerIcon'

type Props = {
  fileIds: string[]
  sheetName?: string
}

export function MoveToDirectorySheet({
  fileIds,
  sheetName = 'moveToDirectory',
}: Props) {
  const isOpen = useSheetOpen(sheetName)
  const allDirs = useAllDirectories()
  const [query, setQuery] = useState('')
  const inputRef = useRef<TextInput | null>(null)
  const [currentDirName, setCurrentDirName] = useState<string | null>(null)
  const [filesInDirCount, setFilesInDirCount] = useState(0)
  const [loadingDirId, setLoadingDirId] = useState<string | null>(null)

  const isSingleFile = fileIds.length === 1
  const dirs = allDirs.data ?? []
  const filtered = query.trim()
    ? dirs.filter((d) =>
        d.name.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : dirs

  const exactMatch =
    query.trim().length > 0 &&
    dirs.some((d) => d.name.toLowerCase() === query.trim().toLowerCase())

  const handleShow = useCallback(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (isOpen) {
      if (isSingleFile) {
        readDirectoryNameForFile(fileIds[0]).then((name) =>
          setCurrentDirName(name ?? null),
        )
      } else {
        countFilesWithDirectories(fileIds).then(setFilesInDirCount)
      }
    } else {
      setQuery('')
      setCurrentDirName(null)
      setFilesInDirCount(0)
      setLoadingDirId(null)
    }
  }, [isOpen, fileIds, isSingleFile])

  const handleMoveToDirectory = useCallback(
    async (directoryId: string) => {
      setLoadingDirId(directoryId)
      try {
        if (fileIds.length === 1) {
          await moveFileToDirectory(fileIds[0], directoryId)
        } else if (fileIds.length > 1) {
          await moveFilesToDirectory(fileIds, directoryId)
        }
        closeSheet()
      } finally {
        setLoadingDirId(null)
      }
    },
    [fileIds],
  )

  const handleRemoveFromDirectory = useCallback(async () => {
    setLoadingDirId('none')
    try {
      if (fileIds.length === 1) {
        await moveFileToDirectory(fileIds[0], null)
      } else if (fileIds.length > 1) {
        await moveFilesToDirectory(fileIds, null)
      }
      closeSheet()
    } finally {
      setLoadingDirId(null)
    }
  }, [fileIds])

  const handleCreateAndMove = useCallback(
    async (name: string) => {
      if (!name.trim()) return
      setLoadingDirId('create')
      try {
        try {
          const dir = await createDirectory(name.trim())
          await handleMoveToDirectory(dir.id)
        } catch {
          const existing = dirs.find(
            (d) => d.name.toLowerCase() === name.trim().toLowerCase(),
          )
          if (existing) {
            await handleMoveToDirectory(existing.id)
          }
        }
      } finally {
        setLoadingDirId(null)
      }
    },
    [dirs, handleMoveToDirectory],
  )

  const handleClose = useCallback(() => {
    setQuery('')
    Keyboard.dismiss()
    closeSheet()
  }, [])

  const fileCount = fileIds.length

  return (
    <ModalSheet
      visible={isOpen}
      onRequestClose={handleClose}
      onShow={handleShow}
      title={`Move ${fileCount} ${fileCount === 1 ? 'file' : 'files'} to folder`}
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
      {isSingleFile ? (
        <View style={styles.infoBanner}>
          <FolderIcon size={16} color={whiteA.a50} />
          <Text style={styles.infoText}>
            {currentDirName
              ? `Currently in ${currentDirName}`
              : 'Not in a folder'}
          </Text>
        </View>
      ) : filesInDirCount > 0 ? (
        <View style={styles.infoBanner}>
          <FoldersIcon size={16} color={whiteA.a50} />
          <Text style={styles.infoText}>
            {filesInDirCount === fileIds.length
              ? 'All files are already in folders'
              : `${filesInDirCount} ${filesInDirCount === 1 ? 'file is' : 'files are'} already in a folder`}
          </Text>
        </View>
      ) : null}
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
            if (query.trim()) handleCreateAndMove(query.trim())
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
            <Pressable
              style={styles.dirRow}
              onPress={handleRemoveFromDirectory}
              disabled={loadingDirId !== null}
            >
              <View style={styles.dirRowLeft}>
                {loadingDirId === 'none' ? (
                  <SpinnerIcon size={18} color={palette.gray[400]} />
                ) : (
                  <XIcon size={18} color={palette.gray[400]} />
                )}
                <Text style={styles.removeText}>No folder</Text>
              </View>
            </Pressable>
            {query.trim().length > 0 && !exactMatch ? (
              <Pressable
                style={styles.dirRow}
                onPress={() => handleCreateAndMove(query.trim())}
                disabled={loadingDirId !== null}
              >
                <View style={styles.dirRowLeft}>
                  {loadingDirId === 'create' ? (
                    <SpinnerIcon size={16} color={palette.blue[400]} />
                  ) : (
                    <PlusIcon size={16} color={palette.blue[400]} />
                  )}
                  <Text style={styles.createText}>Create "{query.trim()}"</Text>
                </View>
              </Pressable>
            ) : null}
          </>
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.dirRow}
            onPress={() => handleMoveToDirectory(item.id)}
            disabled={loadingDirId !== null}
          >
            <View style={styles.dirRowLeft}>
              {loadingDirId === item.id ? (
                <SpinnerIcon size={18} color={palette.blue[400]} />
              ) : (
                <FolderIcon size={18} color={palette.blue[400]} />
              )}
              <Text style={styles.dirName}>{item.name}</Text>
              <Text style={styles.dirCount}>{item.fileCount}</Text>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={
          query.trim().length === 0 ? (
            <Text style={styles.emptyText}>
              No directories yet. Type to create one.
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
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: whiteA.a08,
  },
  infoText: {
    color: whiteA.a50,
    fontSize: 13,
    flex: 1,
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
