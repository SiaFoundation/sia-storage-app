import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  Image,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { AddFileActionSheet } from '../components/AddFileActionSheet'
import { DragToDismiss } from '../components/DragToDismiss'
import { FileActionsSheet } from '../components/FileActionsSheet'
import { FileCarousel } from '../components/FileCarousel'
import { FileGallery } from '../components/FileGallery'
import { FileList } from '../components/FileList'
import { Gradient } from '../components/Gradient'
import { LibraryHeader } from '../components/LibraryHeader'
import { LibraryLocalResetButton } from '../components/LibraryLocalResetButton'
import { LibraryStatusSheet } from '../components/LibraryStatusSheet'
import { LibraryTabBar } from '../components/LibraryTabBar'
import { ManageTagsSheet } from '../components/ManageTagsSheet'
import { MoveToDirectorySheet } from '../components/MoveToDirectorySheet'
import { SelectionBar } from '../components/SelectionBar'
import type { MainStackParamList } from '../stacks/types'
import {
  enterSelectionMode,
  exitSelectionMode,
  toggleFileSelection,
  useIsSelectionMode,
  useSelectedCount,
  useSelectedFileIds,
} from '../stores/fileSelection'
import type { FileRecord } from '../stores/files'
import {
  type Category,
  type FileListParams,
  useFileList,
  useLibraryCount,
} from '../stores/library'
import { openSheet } from '../stores/sheets'
import { useIsSyncingDown } from '../stores/syncDown'
import { useViewSettings } from '../stores/viewSettings'
import { colors, overlay, palette, whiteA } from '../styles/colors'

type Props = NativeStackScreenProps<MainStackParamList, 'LibraryHome'>

export function LibraryScreen({ route, navigation }: Props) {
  const vs = useViewSettings('library')
  const isSyncing = useIsSyncingDown()
  const filters: FileListParams = useMemo(
    () => ({
      scope: 'library',
      sortBy: vs.sortBy,
      sortDir: vs.sortDir,
      categories: vs.selectedCategories,
    }),
    [vs.sortBy, vs.sortDir, vs.selectedCategories],
  )
  const files = useFileList(filters)
  const fileCount = useLibraryCount()
  const [selectedFile, setSelectedFile] = useState<FileRecord | null>(() => {
    const openFileId = route.params?.openFileId
    if (!openFileId) return null
    return files.data?.find((f) => f.id === openFileId) ?? null
  })
  const [isCarouselZoomed, setIsCarouselZoomed] = useState(false)
  const [isCarouselDetail, setIsCarouselDetail] = useState(false)
  const [isDraggingToDismiss, setIsDraggingToDismiss] = useState(false)
  const fadeAnim = useRef(new Animated.Value(0)).current
  const scaleAnim = useRef(new Animated.Value(0.95)).current

  const isSelectionMode = useIsSelectionMode()
  const selectedFileIds = useSelectedFileIds()
  const selectedCount = useSelectedCount()

  const isSelectionModeRef = useRef(isSelectionMode)
  useEffect(() => {
    isSelectionModeRef.current = isSelectionMode
  }, [isSelectionMode])

  const handlePressItem = useCallback((file: FileRecord) => {
    if (isSelectionModeRef.current) {
      toggleFileSelection(file.id)
    } else {
      setActionFileId(null)
      setSelectedFile(file)
    }
  }, [])

  const [actionFileId, setActionFileId] = useState<string | null>(null)

  const handleLongPressItem = useCallback((file: FileRecord) => {
    if (isSelectionModeRef.current) {
      toggleFileSelection(file.id)
      return
    }
    setActionFileId(file.id)
    openSheet('fileActions')
  }, [])

  const handleShowCarouselActions = useCallback(() => {
    openSheet('fileActions')
  }, [])

  const handleShowTagSheet = useCallback(() => {
    openSheet('manageFileTags')
  }, [])

  const handleMoveToDirectory = useCallback(() => {
    openSheet('moveToDirectory')
  }, [])

  const handleOpenSelectionActions = useCallback(() => {
    openSheet('fileActions')
  }, [])

  const handleBulkActionComplete = useCallback(() => {
    exitSelectionMode()
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

  const actionSheetFileIds = isSelectionMode
    ? Array.from(selectedFileIds)
    : selectedFile
      ? [selectedFile.id]
      : actionFileId
        ? [actionFileId]
        : []

  const categorySet = new Set(vs.selectedCategories)

  const title = (() => {
    const n = categorySet.size
    if (n === 1) {
      const only = Array.from(categorySet)[0] as Category
      switch (only) {
        case 'Image':
          return 'Photos'
        case 'Video':
          return 'Videos'
        case 'Audio':
          return 'Audio'
        case 'Files':
          return 'Files'
        default:
          return 'Library'
      }
    }
    return 'Library'
  })()

  const subtitle = (() => {
    if (categorySet.size > 0) {
      const filtered = files.data?.length ?? 0
      return `${filtered.toLocaleString()} results`
    }
    const total = fileCount.data ?? 0
    return `${total.toLocaleString()} ${total === 1 ? 'item' : 'items'}`
  })()

  return (
    <View style={styles.container}>
      <Gradient
        fadeTo="bottom"
        overlayTopColor={overlay.gradientDark}
        overlayBottomColor={overlay.gradientLight}
        style={styles.topBlur}
      />
      <LibraryHeader
        title={title}
        subtitle={subtitle}
        scope="library"
        isSelectionMode={isSelectionMode}
        selectedCount={selectedCount}
        onEnterSelection={enterSelectionMode}
        onExitSelection={exitSelectionMode}
        onOpenSelectionActions={handleOpenSelectionActions}
        onNavigateMenu={() => navigation.navigate('MenuTab' as never)}
      />
      {files.isLoading ? (
        <View style={styles.emptyWrap}>
          <ActivityIndicator color={palette.blue[400]} />
        </View>
      ) : fileCount.data ? (
        files.data && files.data.length > 0 ? (
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
            <Text style={styles.emptyTitle}>No files found</Text>
            <Text style={styles.emptyText}>
              {files.error
                ? files.error.message
                : 'No files matching the selected filters.'}
            </Text>
            {files.error ? <LibraryLocalResetButton /> : null}
          </View>
        )
      ) : isSyncing && categorySet.size === 0 ? (
        <View style={styles.emptyWrap}>
          <ActivityIndicator color={palette.blue[400]} />
          <Text style={styles.emptyTitle}>Syncing your files</Text>
        </View>
      ) : (
        <View style={styles.emptyWrap}>
          <Image
            style={styles.emptyImage}
            source={require('../../assets/image-stack.png')}
          />
          <Text style={styles.emptyTitle}>Add files to get started</Text>
          <Text style={styles.emptyText}>
            Files are sharded and encrypted and synced directly to the Sia host
            network.
          </Text>
        </View>
      )}
      <AddFileActionSheet />
      <LibraryStatusSheet />
      {isSelectionMode ? (
        <SelectionBar onOpenSelectionActions={handleOpenSelectionActions} />
      ) : (
        <LibraryTabBar />
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
              setSelectedFile(null)
              setIsDraggingToDismiss(false)
              setIsCarouselZoomed(false)
              setIsCarouselDetail(false)
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
              onClose={() => {
                setSelectedFile(null)
                setIsCarouselZoomed(false)
                setIsCarouselDetail(false)
              }}
              onShowActionSheet={handleShowCarouselActions}
              onShowTagSheet={handleShowTagSheet}
              onMoveToDirectory={handleMoveToDirectory}
              onZoomChange={setIsCarouselZoomed}
              onViewStyleChange={(s) => setIsCarouselDetail(s === 'detail')}
              isDismissing={isDraggingToDismiss}
            />
          </DragToDismiss>
        </Animated.View>
      ) : null}
      {actionSheetFileIds.length > 0 ? (
        <>
          <FileActionsSheet
            fileIds={actionSheetFileIds}
            sheetName="fileActions"
            onComplete={isSelectionMode ? handleBulkActionComplete : undefined}
          />
          {actionSheetFileIds.length === 1 ? (
            <ManageTagsSheet
              fileId={actionSheetFileIds[0]}
              sheetName="manageFileTags"
            />
          ) : null}
        </>
      ) : null}
      <MoveToDirectorySheet fileIds={actionSheetFileIds} />
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
  emptyImage: { width: 140, height: 140 },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  emptyTitle: {
    color: palette.gray[100],
    fontWeight: '800',
    fontSize: 18,
    paddingTop: 12,
    paddingBottom: 6,
  },
  emptyText: { color: whiteA.a70, textAlign: 'center' },
  carouselOverlay: {
    zIndex: 100,
  },
})
