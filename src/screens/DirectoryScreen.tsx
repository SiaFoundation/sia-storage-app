import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import {
  ArrowLeftIcon,
  FolderPlusIcon,
  ListFilterIcon,
  MoreVerticalIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react-native'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { ActionSheet } from '../components/ActionSheet'
import { ActionSheetButton } from '../components/ActionSheetButton'
import { AddFileActionSheet } from '../components/AddFileActionSheet'
import { BottomControlBar, FloatingPill } from '../components/BottomControlBar'
import { DragToDismiss } from '../components/DragToDismiss'
import { FileActionsSheet } from '../components/FileActionsSheet'
import { FileCarousel } from '../components/FileCarousel'
import { FileGallery } from '../components/FileGallery'
import { FileList } from '../components/FileList'
import { Gradient } from '../components/Gradient'
import { IconButton } from '../components/IconButton'
import { ManageTagsSheet } from '../components/ManageTagsSheet'
import { MoveToDirectorySheet } from '../components/MoveToDirectorySheet'
import { ScreenHeader } from '../components/ScreenHeader'
import { SelectionBar } from '../components/SelectionBar'
import { ViewSettingsMenu } from '../components/ViewSettingsMenu'
import type { MainStackParamList } from '../stacks/types'
import { deleteDirectory, moveFilesToDirectory } from '../stores/directories'
import {
  enterSelectionMode,
  exitSelectionMode,
  toggleFileSelection,
  useIsSelectionMode,
  useSelectedFileIds,
} from '../stores/fileSelection'
import type { FileRecord } from '../stores/files'
import {
  type FileListParams,
  useDirectoryFileCount,
  useFileList,
} from '../stores/library'
import { closeSheet, openSheet, useSheetOpen } from '../stores/sheets'
import { useViewSettings } from '../stores/viewSettings'
import { colors, overlay, palette, whiteA } from '../styles/colors'

type Props = NativeStackScreenProps<MainStackParamList, 'DirectoryScreen'>

export function DirectoryScreen({ route, navigation }: Props) {
  const { directoryId, directoryName } = route.params
  const scope = `dir.${directoryId}`
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

  const handleOpenSelectionActions = useCallback(() => {
    openSheet('directoryFileActions')
  }, [])

  const handleBulkActionComplete = useCallback(() => {
    exitSelectionMode()
  }, [])

  const handleFilesAdded = useCallback(
    (addedFiles: FileRecord[]) => {
      void moveFilesToDirectory(
        addedFiles.map((f) => f.id),
        directoryId,
      )
    },
    [directoryId],
  )

  const actionSheetFileIds = isSelectionMode
    ? Array.from(selectedFileIds)
    : selectedFile
      ? [selectedFile.id]
      : actionFileId
        ? [actionFileId]
        : []

  const dirCount = useDirectoryFileCount(directoryId)
  const fileCount = dirCount.data ?? 0
  const subtitle = `${fileCount.toLocaleString()} ${fileCount === 1 ? 'file' : 'files'}`
  const dirActionsOpen = useSheetOpen('directoryActions')

  const handleDeleteDirectory = useCallback(() => {
    closeSheet()
    setTimeout(() => {
      Alert.alert(
        `Delete "${directoryName}"?`,
        'This will remove the directory. Files will be moved out but not deleted.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              await deleteDirectory(directoryId)
              navigation.goBack()
            },
          },
        ],
      )
    }, 300)
  }, [directoryId, directoryName, navigation])

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
          <View>
            <Text style={styles.titleLarge} numberOfLines={1}>
              {directoryName}
            </Text>
            <Text style={styles.subtitle}>{subtitle}</Text>
          </View>
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
      ) : files.data.length > 0 ? (
        vs.viewMode === 'gallery' ? (
          <FileGallery
            filters={filters}
            onPressItem={handlePressItem}
            onLongPressItem={handleLongPressItem}
          />
        ) : (
          <FileList
            filters={filters}
            onPressItem={handlePressItem}
            onLongPressItem={handleLongPressItem}
          />
        )
      ) : (
        <View style={styles.emptyWrap}>
          <Image
            style={styles.emptyImage}
            source={require('../../assets/image-stack.png')}
          />
          <Text style={styles.emptyTitle}>No files in this directory</Text>
          <Text style={styles.emptyText}>
            Move files here from the file actions menu.
          </Text>
        </View>
      )}

      <AddFileActionSheet
        sheetName="directoryAddFile"
        onFilesAdded={handleFilesAdded}
      />
      {isSelectionMode ? (
        <SelectionBar
          onOpenSelectionActions={handleOpenSelectionActions}
          moveToDirectorySheet="directoryMoveToDir"
        />
      ) : (
        <BottomControlBar variant="floating" style={styles.controlBar}>
          <FloatingPill style={styles.actions}>
            <IconButton
              onPress={() => openSheet('directoryAddFile')}
              accessibilityLabel="Add files"
            >
              <FolderPlusIcon color={palette.gray[50]} size={20} />
            </IconButton>
            <IconButton
              onPress={() => openSheet('directoryActions')}
              accessibilityLabel="More options"
            >
              <MoreVerticalIcon color={palette.gray[50]} size={22} />
            </IconButton>
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

      <ActionSheet visible={dirActionsOpen} onRequestClose={() => closeSheet()}>
        <ActionSheetButton
          variant="danger"
          icon={<Trash2Icon size={18} />}
          onPress={handleDeleteDirectory}
        >
          Delete directory
        </ActionSheetButton>
      </ActionSheet>
      {actionSheetFileIds.length > 0 ? (
        <>
          <FileActionsSheet
            fileIds={actionSheetFileIds}
            sheetName="directoryFileActions"
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
      />
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
  titleLarge: {
    color: palette.gray[50],
    fontSize: 24,
    fontWeight: '800',
  },
  subtitle: {
    color: whiteA.a50,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
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
  emptyImage: { width: 140, height: 140 },
  emptyTitle: {
    color: palette.gray[100],
    fontWeight: '800',
    fontSize: 18,
    paddingTop: 12,
    paddingBottom: 6,
  },
  emptyText: { color: whiteA.a70, textAlign: 'center' },
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
