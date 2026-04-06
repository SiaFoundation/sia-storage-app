import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import {
  type DirectoryWithCount,
  UNFILED_DIRECTORY_ID,
} from '@siastorage/core/db/operations'
import {
  type FileListParams,
  useDirectoryChildren,
  useDirectoryFileCount,
  useFileList,
} from '@siastorage/core/stores'
import type { FileRecord } from '@siastorage/core/types'
import {
  ArrowLeftIcon,
  FilePlusIcon,
  FolderIcon,
  FolderPlusIcon,
  ListFilterIcon,
  MoreVerticalIcon,
  PencilIcon,
  SearchIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react-native'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { ActionSheet } from '../components/ActionSheet'
import { ActionSheetButton } from '../components/ActionSheetButton'
import { AddFileActionSheet } from '../components/AddFileActionSheet'
import { BottomControlBar, FloatingPill } from '../components/BottomControlBar'
import { CreateDirectorySheet } from '../components/CreateDirectorySheet'
import { DirectoryListItem } from '../components/DirectoryListItem'
import { DragToDismiss } from '../components/DragToDismiss'
import { EmptyState } from '../components/EmptyState'
import { FileActionsSheet } from '../components/FileActionsSheet'
import { FileCarousel } from '../components/FileCarousel'
import { FileGallery } from '../components/FileGallery'
import { FileList } from '../components/FileList'
import { Gradient } from '../components/Gradient'
import { IconButton } from '../components/IconButton'
import { ManageTagsSheet } from '../components/ManageTagsSheet'
import { MoveToDirectorySheet } from '../components/MoveToDirectorySheet'
import { RenameSheet } from '../components/RenameSheet'
import { ScreenHeader } from '../components/ScreenHeader'
import { ScreenHeaderTitle } from '../components/ScreenHeaderTitle'
import { SelectionBar } from '../components/SelectionBar'
import { ViewSettingsMenu } from '../components/ViewSettingsMenu'
import { useToast } from '../lib/toastContext'
import type { MainStackParamList } from '../stacks/types'
import { app } from '../stores/appService'
import {
  enterSelectionMode,
  exitSelectionMode,
  toggleFileSelection,
  useIsSelectionMode,
  useSelectedFileIds,
} from '../stores/fileSelection'
import { closeSheet, openSheet, useSheetOpen } from '../stores/sheets'
import { useViewSettings } from '../stores/viewSettings'
import { colors, overlay, palette } from '../styles/colors'

type Props = NativeStackScreenProps<MainStackParamList, 'DirectoryScreen'>

export function DirectoryScreen({ route, navigation }: Props) {
  const toast = useToast()
  const {
    directoryId,
    directoryName: initialDirectoryName,
    directoryPath: initialDirectoryPath,
  } = route.params
  const [directoryName, setDirectoryName] = useState(initialDirectoryName)
  const [directoryPath, setDirectoryPath] = useState(initialDirectoryPath)
  const isUnfiled = directoryId === UNFILED_DIRECTORY_ID
  const scope = `dir.${directoryId}`
  const subdirectories = useDirectoryChildren(isUnfiled ? null : directoryPath)
  const vs = useViewSettings(scope)
  const filters: FileListParams = useMemo(
    () => ({
      scope: `dir:${directoryId}`,
      sortBy: vs.sortBy,
      sortDir: vs.sortDir,
      categories: vs.selectedCategories,
      directoryId,
    }),
    [directoryId, vs.sortBy, vs.sortDir, vs.selectedCategories],
  )
  const files = useFileList(filters)
  const isSelectionMode = useIsSelectionMode()
  const selectedFileIds = useSelectedFileIds()
  const isSelectionModeRef = useRef(isSelectionMode)

  const [selectedFile, setSelectedFile] = useState<FileRecord | null>(null)
  const [isCarouselZoomed, setIsCarouselZoomed] = useState(false)
  const [isCarouselDetail, setIsCarouselDetail] = useState(false)
  const [isDraggingToDismiss, setIsDraggingToDismiss] = useState(false)
  const [actionFileId, setActionFileId] = useState<string | null>(null)
  const fadeAnim = useRef(new Animated.Value(0)).current
  const scaleAnim = useRef(new Animated.Value(0.95)).current

  useEffect(() => {
    isSelectionModeRef.current = isSelectionMode
  }, [isSelectionMode])

  useEffect(() => {
    return () => {
      exitSelectionMode()
    }
  }, [])

  useEffect(() => {
    if (selectedFile) {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          useNativeDriver: true,
          tension: 65,
          friction: 8,
        }),
      ]).start()
    } else {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 0.95,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start()
    }
  }, [selectedFile, fadeAnim, scaleAnim])

  const handlePressItem = useCallback((file: FileRecord) => {
    if (isSelectionModeRef.current) {
      toggleFileSelection(file.id)
    } else {
      setActionFileId(null)
      setSelectedFile(file)
    }
  }, [])

  const handleLongPressItem = useCallback((file: FileRecord) => {
    if (isSelectionModeRef.current) {
      toggleFileSelection(file.id)
      return
    }
    setActionFileId(file.id)
    openSheet('directoryFileActions')
  }, [])

  const handleCloseCarousel = useCallback(() => {
    setSelectedFile(null)
    setIsCarouselZoomed(false)
    setIsCarouselDetail(false)
  }, [])

  const handleBulkActionComplete = useCallback(() => {
    exitSelectionMode()
  }, [])

  const handleFilesAdded = useCallback(
    (addedFiles: FileRecord[]) => {
      if (isUnfiled) return
      void app().directories.moveFiles(
        addedFiles.map((f) => f.id),
        directoryId,
      )
    },
    [directoryId, isUnfiled],
  )

  const actionSheetFileIds = isSelectionMode
    ? selectedFileIds
    : selectedFile
      ? [selectedFile.id]
      : actionFileId
        ? [actionFileId]
        : []

  const dirCount = useDirectoryFileCount(directoryId)
  const fileCount = dirCount.data ?? 0
  const subDirCount = isUnfiled ? 0 : (subdirectories.data?.length ?? 0)
  const subtitleParts: string[] = []
  subtitleParts.push(
    `${fileCount.toLocaleString()} ${fileCount === 1 ? 'file' : 'files'}`,
  )
  if (subDirCount > 0) {
    subtitleParts.push(
      `${subDirCount} ${subDirCount === 1 ? 'folder' : 'folders'}`,
    )
  }
  const subtitle = subtitleParts.join(', ')
  const dirActionsOpen = useSheetOpen('directoryActions')

  const handleRenameDirectory = useCallback(
    async (newName: string) => {
      const updated = await app().directories.rename(directoryId, newName)
      setDirectoryName(updated.name)
      setDirectoryPath(updated.path)
      toast.show(`Renamed to "${updated.name}"`)
    },
    [directoryId, toast],
  )

  const handleSelectSubdirectory = useCallback(
    (dir: DirectoryWithCount) => {
      navigation.push('DirectoryScreen', {
        directoryId: dir.id,
        directoryName: dir.name,
        directoryPath: dir.path,
      })
    },
    [navigation],
  )

  const handleCreateSubfolder = useCallback(() => {
    closeSheet()
    setTimeout(() => openSheet('createSubdirectory'), 300)
  }, [])

  const hasSubdirs = !isUnfiled && (subdirectories.data?.length ?? 0) > 0

  const directoryListHeader = useMemo(() => {
    if (isUnfiled || !subdirectories.data?.length) return null
    return (
      <View>
        {subdirectories.data.map((sub) => (
          <DirectoryListItem
            key={sub.id}
            dir={sub}
            onPress={() => handleSelectSubdirectory(sub)}
          />
        ))}
      </View>
    )
  }, [subdirectories.data, isUnfiled, handleSelectSubdirectory])

  const handleDeleteDirectory = useCallback(() => {
    closeSheet()
    setTimeout(() => {
      Alert.alert(
        `Delete "${directoryName}"?`,
        'This will delete the folder and all its contents, and move files to trash.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              await app().directories.deleteAndTrashFiles(directoryId)
              navigation.goBack()
              toast.show(`Deleted "${directoryName}"`)
            },
          },
        ],
      )
    }, 300)
  }, [directoryId, directoryName, navigation, toast])

  return (
    <View style={styles.container}>
      <Gradient
        fadeTo="bottom"
        overlayTopColor={overlay.gradientDark}
        overlayBottomColor={overlay.gradientLight}
        style={styles.topBlur}
      />
      <ScreenHeader>
        <View style={styles.headerLeft}>
          <IconButton
            onPress={() => navigation.goBack()}
            accessibilityLabel="Back"
          >
            <ArrowLeftIcon color={palette.gray[50]} size={22} />
          </IconButton>
          <ScreenHeaderTitle
            title={directoryName}
            subtitle={subtitle}
            icon={<FolderIcon color={palette.blue[400]} size={22} />}
          />
        </View>
        <View style={styles.buttonRow}>
          <ViewSettingsMenu scope={scope}>
            <IconButton accessibilityLabel="View settings">
              <ListFilterIcon color={palette.gray[50]} size={22} />
            </IconButton>
          </ViewSettingsMenu>
          {isSelectionMode ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => exitSelectionMode()}
              style={styles.headerPill}
            >
              <XIcon color={palette.gray[50]} size={18} />
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={() => enterSelectionMode()}
              style={styles.headerPill}
            >
              <Text style={styles.selectText}>Select</Text>
            </Pressable>
          )}
        </View>
      </ScreenHeader>

      {files.isLoading || !files.data ? (
        <View style={styles.emptyWrap}>
          <ActivityIndicator color={palette.blue[400]} />
        </View>
      ) : files.data.length > 0 || hasSubdirs ? (
        vs.viewMode === 'gallery' ? (
          <FileGallery
            filters={filters}
            onPressItem={handlePressItem}
            onLongPressItem={handleLongPressItem}
            ListHeaderComponent={directoryListHeader}
          />
        ) : (
          <FileList
            filters={filters}
            onPressItem={handlePressItem}
            onLongPressItem={handleLongPressItem}
            ListHeaderComponent={directoryListHeader}
          />
        )
      ) : (
        <EmptyState
          image={require('../../assets/image-stack.png')}
          title="No files in this folder"
          message="Move files here from the file actions menu."
        />
      )}

      <AddFileActionSheet
        sheetName="directoryAddFile"
        onFilesAdded={handleFilesAdded}
      />
      {isSelectionMode ? (
        <SelectionBar
          onComplete={handleBulkActionComplete}
          moveToDirectorySheet="directoryMoveToDir"
        />
      ) : (
        <BottomControlBar variant="floating" style={styles.controlBar}>
          <FloatingPill style={styles.actions}>
            <IconButton
              onPress={() => openSheet('directoryAddFile')}
              accessibilityLabel="Add files"
            >
              <FilePlusIcon color={palette.gray[50]} size={20} />
            </IconButton>
            <IconButton
              onPress={() => navigation.navigate('Search')}
              accessibilityLabel="Search"
            >
              <SearchIcon color={palette.gray[50]} size={22} />
            </IconButton>
            {!isUnfiled ? (
              <IconButton
                onPress={() => openSheet('directoryActions')}
                accessibilityLabel="More options"
              >
                <MoreVerticalIcon color={palette.gray[50]} size={22} />
              </IconButton>
            ) : null}
          </FloatingPill>
        </BottomControlBar>
      )}

      {selectedFile ? (
        <Animated.View
          style={[
            StyleSheet.absoluteFillObject,
            styles.carouselOverlay,
            {
              opacity: fadeAnim,
              transform: [{ scale: scaleAnim }],
            },
          ]}
          pointerEvents="box-none"
        >
          <DragToDismiss
            onDismiss={() => {
              handleCloseCarousel()
              setIsDraggingToDismiss(false)
            }}
            onDragStart={() => setIsDraggingToDismiss(true)}
            onDragCancel={() => setIsDraggingToDismiss(false)}
            enabled={!isCarouselZoomed && !isCarouselDetail}
          >
            <FileCarousel
              initialId={selectedFile.id}
              initialFile={selectedFile}
              sortBy={vs.sortBy}
              sortDir={vs.sortDir}
              categories={vs.selectedCategories}
              directoryId={directoryId}
              onClose={handleCloseCarousel}
              onShowActionSheet={() => openSheet('directoryFileActions')}
              onShowTagSheet={() => openSheet('directoryManageTags')}
              onMoveToDirectory={() => openSheet('directoryMoveToDir')}
              onZoomChange={setIsCarouselZoomed}
              onViewStyleChange={(s) => setIsCarouselDetail(s === 'detail')}
              isDismissing={isDraggingToDismiss}
            />
          </DragToDismiss>
        </Animated.View>
      ) : null}

      <ActionSheet
        visible={dirActionsOpen}
        onRequestClose={() => closeSheet('directoryActions')}
      >
        <ActionSheetButton
          icon={<FolderPlusIcon size={18} />}
          onPress={handleCreateSubfolder}
        >
          New folder
        </ActionSheetButton>
        <ActionSheetButton
          icon={<PencilIcon size={18} />}
          onPress={() => {
            closeSheet()
            setTimeout(() => openSheet('renameDirectory'), 300)
          }}
        >
          Rename folder
        </ActionSheetButton>
        <ActionSheetButton
          variant="danger"
          icon={<Trash2Icon size={18} />}
          onPress={handleDeleteDirectory}
        >
          Delete folder
        </ActionSheetButton>
      </ActionSheet>
      <RenameSheet
        sheetName="renameDirectory"
        title="Rename Folder"
        placeholder="Folder name"
        initialValue={directoryName}
        onRename={handleRenameDirectory}
      />
      {actionSheetFileIds.length > 0 ? (
        <>
          <FileActionsSheet
            fileIds={actionSheetFileIds}
            sheetName="directoryFileActions"
            manageTagsSheet="directoryManageTags"
            moveToDirectorySheet="directoryMoveToDir"
            onComplete={isSelectionMode ? handleBulkActionComplete : undefined}
          />
          {actionSheetFileIds.length === 1 ? (
            <ManageTagsSheet
              fileId={actionSheetFileIds[0]}
              sheetName="directoryManageTags"
            />
          ) : null}
        </>
      ) : null}
      <MoveToDirectorySheet
        fileIds={actionSheetFileIds}
        sheetName="directoryMoveToDir"
        onComplete={isSelectionMode ? handleBulkActionComplete : undefined}
      />
      {!isUnfiled ? (
        <CreateDirectorySheet
          sheetName="createSubdirectory"
          parentPath={directoryPath}
          onCreated={(subId, subName, subPath) => {
            navigation.push('DirectoryScreen', {
              directoryId: subId,
              directoryName: subName,
              directoryPath: subPath,
            })
          }}
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgCanvas },
  topBlur: {
    zIndex: 10,
    pointerEvents: 'none',
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 180,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  headerPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: overlay.pill,
  },
  selectText: {
    color: palette.gray[50],
    fontSize: 14,
    fontWeight: '600',
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  controlBar: {
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingRight: 16,
  },
  actions: {
    gap: 8,
  },
  carouselOverlay: {
    zIndex: 100,
  },
})
