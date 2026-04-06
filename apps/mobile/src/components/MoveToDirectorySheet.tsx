import { directoryParentPath } from '@siastorage/core/db/operations'
import { useDirectoryChildren } from '@siastorage/core/stores'
import {
  ArrowLeftIcon,
  ChevronRightIcon,
  FolderIcon,
  FoldersIcon,
  PlusIcon,
  XIcon,
} from 'lucide-react-native'
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
import { closeSheet, useSheetOpen } from '../stores/sheets'
import { palette, whiteA } from '../styles/colors'
import { ModalSheet } from './ModalSheet'
import { SpinnerIcon } from './SpinnerIcon'

type Props = {
  fileIds: string[]
  sheetName?: string
  onComplete?: () => void
}

export function MoveToDirectorySheet({
  fileIds,
  sheetName = 'moveToDirectory',
  onComplete,
}: Props) {
  const toast = useToast()
  const isOpen = useSheetOpen(sheetName)
  const [query, setQuery] = useState('')
  const inputRef = useRef<TextInput | null>(null)
  const [currentDirPath, setCurrentDirPath] = useState<string | null>(null)
  const [filesInDirCount, setFilesInDirCount] = useState(0)
  const [loadingDirId, setLoadingDirId] = useState<string | null>(null)

  const isSingleFile = fileIds.length === 1
  const children = useDirectoryChildren(currentDirPath)
  const dirs = children.data ?? []
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
    if (isOpen) {
      if (!isSingleFile) {
        app()
          .directories.countFilesWithDirectories(fileIds)
          .then(setFilesInDirCount)
      }
    } else {
      setQuery('')
      setCurrentDirPath(null)
      setFilesInDirCount(0)
      setLoadingDirId(null)
    }
  }, [isOpen, fileIds, isSingleFile])

  const handleMoveToDirectory = useCallback(
    async (directoryId: string) => {
      setLoadingDirId(directoryId)
      try {
        const targetDir = dirs.find((d) => d.id === directoryId)
        await app().directories.moveFiles(fileIds, directoryId)
        closeSheet()
        toast.show(
          targetDir
            ? `Moved to "${targetDir.name}"`
            : `Moved ${fileIds.length === 1 ? 'file' : 'files'} to folder`,
        )
        onComplete?.()
      } finally {
        setLoadingDirId(null)
      }
    },
    [fileIds, dirs, toast, onComplete],
  )

  const handleRemoveFromDirectory = useCallback(async () => {
    setLoadingDirId('none')
    try {
      await app().directories.moveFiles(fileIds, null)
      closeSheet()
      toast.show('Removed from folder')
      onComplete?.()
    } finally {
      setLoadingDirId(null)
    }
  }, [fileIds, toast, onComplete])

  const handleCreateAndMove = useCallback(
    async (name: string) => {
      if (!name.trim()) return
      setLoadingDirId('create')
      try {
        try {
          const dir = await app().directories.create(
            name.trim(),
            currentDirPath ?? undefined,
          )
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
    [dirs, currentDirPath, handleMoveToDirectory],
  )

  const handleClose = useCallback(() => {
    setQuery('')
    setCurrentDirPath(null)
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
            {currentDirPath !== null
              ? `Browsing: ${currentDirPath}`
              : 'Root folders'}
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
            {currentDirPath !== null ? (
              <Pressable
                style={styles.dirRow}
                onPress={() => {
                  setCurrentDirPath(directoryParentPath(currentDirPath))
                  setQuery('')
                }}
                disabled={loadingDirId !== null}
              >
                <View style={styles.dirRowLeft}>
                  <ArrowLeftIcon size={18} color={palette.gray[400]} />
                  <Text style={styles.backText}>Back</Text>
                </View>
              </Pressable>
            ) : null}
            {currentDirPath === null ? (
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
            ) : null}
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
          <View style={styles.dirRow}>
            <Pressable
              style={styles.dirRowLeft}
              onPress={() => handleMoveToDirectory(item.id)}
              disabled={loadingDirId !== null}
            >
              {loadingDirId === item.id ? (
                <SpinnerIcon size={18} color={palette.blue[400]} />
              ) : (
                <FolderIcon size={18} color={palette.blue[400]} />
              )}
              <Text style={styles.dirName}>{item.name}</Text>
              <Text style={styles.dirCount}>{item.fileCount}</Text>
            </Pressable>
            {item.subdirectoryCount > 0 ? (
              <Pressable
                style={styles.chevronTarget}
                onPress={() => {
                  setCurrentDirPath(item.path)
                  setQuery('')
                }}
              >
                <ChevronRightIcon size={18} color={whiteA.a50} />
              </Pressable>
            ) : null}
          </View>
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
  },
  chevronTarget: {
    paddingLeft: 16,
    paddingVertical: 8,
    paddingRight: 4,
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
  backText: {
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
