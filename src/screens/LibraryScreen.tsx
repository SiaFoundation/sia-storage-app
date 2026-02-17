import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { MenuIcon } from 'lucide-react-native'
import { useCallback, useEffect, useRef, useState } from 'react'
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
import { IconButton } from '../components/IconButton'
import { LibraryAppStatusIcon } from '../components/LibraryAppStatusIcon'
import { LibraryControlBar } from '../components/LibraryControlBar'
import { LibraryLocalResetButton } from '../components/LibraryLocalResetButton'
import { LibraryStatusSheet } from '../components/LibraryStatusSheet'
import { ScreenHeader } from '../components/ScreenHeader'
import type { MainStackParamList } from '../stacks/types'
import {
  enterSelectionMode,
  exitSelectionMode,
  selectFile,
  toggleFileSelection,
  useIsSelectionMode,
  useSelectedFileIds,
} from '../stores/fileSelection'
import type { FileRecord } from '../stores/files'
import {
  type Category,
  useFileList,
  useLibrary,
  useLibraryCount,
} from '../stores/library'
import { useLibraryViewMode } from '../stores/settings'
import { openSheet } from '../stores/sheets'
import { useIsSyncingDown } from '../stores/syncDown'
import { colors, overlay, palette, whiteA } from '../styles/colors'

type Props = NativeStackScreenProps<MainStackParamList, 'LibraryHome'>

export function LibraryScreen({ route, navigation }: Props) {
  const viewMode = useLibraryViewMode()
  const isSyncing = useIsSyncingDown()
  const { selectedCategories, searchQuery } = useLibrary()
  const files = useFileList()
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

  // Selection mode state
  const isSelectionMode = useIsSelectionMode()
  const selectedFileIds = useSelectedFileIds()

  // Ref to track selection mode for stable callbacks
  const isSelectionModeRef = useRef(isSelectionMode)
  useEffect(() => {
    isSelectionModeRef.current = isSelectionMode
  }, [isSelectionMode])

  // Handle item press - opens carousel or toggles selection
  // Using ref for isSelectionMode to keep callback reference stable
  const handlePressItem = useCallback((file: FileRecord) => {
    if (isSelectionModeRef.current) {
      toggleFileSelection(file.id)
    } else {
      setSelectedFile(file)
    }
  }, [])

  // Handle long press - enters selection mode with file selected
  // Using ref for isSelectionMode to keep callback reference stable
  const handleLongPressItem = useCallback((file: FileRecord) => {
    if (!isSelectionModeRef.current) {
      enterSelectionMode()
    }
    selectFile(file.id)
  }, [])

  // Handle opening the action sheet from carousel
  const handleShowCarouselActions = useCallback(() => {
    openSheet('fileActions')
  }, [])

  // Handle opening selection action sheet
  const handleOpenSelectionActions = useCallback(() => {
    openSheet('fileActions')
  }, [])

  // Handle completion of bulk action
  const handleBulkActionComplete = useCallback(() => {
    exitSelectionMode()
  }, [])

  // Animate carousel fade in/out with scale
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

  // Get file IDs for action sheet
  const actionSheetFileIds = isSelectionMode
    ? Array.from(selectedFileIds)
    : selectedFile
      ? [selectedFile.id]
      : []

  return (
    <View style={styles.container}>
      <Gradient
        fadeTo="bottom"
        overlayTopColor={overlay.gradientDark}
        overlayBottomColor={overlay.gradientLight}
        style={styles.topBlur}
      />
      <ScreenHeader>
        <View style={styles.headerTitles}>
          <Text style={styles.headerTitleLarge} pointerEvents="none">
            {(() => {
              const n = selectedCategories.size
              if (n === 1) {
                const only = Array.from(selectedCategories)[0] as Category
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
            })()}
          </Text>
          <Text style={styles.headerSubtitle}>
            {(() => {
              const total = fileCount.data ?? 0
              const filtered = files.data?.length ?? 0
              if (
                searchQuery.trim().length > 0 ||
                selectedCategories.size > 0
              ) {
                return `${filtered} results`
              }
              return `${total} ${total === 1 ? 'item' : 'items'}`
            })()}
          </Text>
        </View>
        <View style={styles.buttonRow}>
          <LibraryAppStatusIcon />
          <IconButton
            onPress={() => navigation.navigate('MenuTab' as never)}
            style={[styles.headerIcon, { paddingHorizontal: 4 }]}
            accessibilityLabel="Menu"
          >
            <MenuIcon color={palette.gray[50]} />
          </IconButton>
        </View>
      </ScreenHeader>
      {files.isLoading ? (
        <View style={styles.emptyWrap}>
          <ActivityIndicator color={palette.blue[400]} />
        </View>
      ) : fileCount.data ? (
        files.data && files.data.length > 0 ? (
          viewMode.data === 'gallery' ? (
            <FileGallery
              onPressItem={handlePressItem}
              onLongPressItem={handleLongPressItem}
            />
          ) : (
            <FileList
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
      ) : isSyncing &&
        searchQuery.trim().length === 0 &&
        selectedCategories.size === 0 ? (
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
      <LibraryControlBar
        navigation={navigation}
        route={route}
        onOpenSelectionActions={handleOpenSelectionActions}
      />
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
          {/* Disable drag-to-dismiss when zoomed into an image or viewing
              file details, so the detail ScrollView can scroll freely. */}
          <DragToDismiss
            onDismiss={() => {
              setSelectedFile(null)
              setIsDraggingToDismiss(false)
            }}
            onDragStart={() => setIsDraggingToDismiss(true)}
            onDragCancel={() => setIsDraggingToDismiss(false)}
            enabled={!isCarouselZoomed && !isCarouselDetail}
          >
            <FileCarousel
              initialId={selectedFile.id}
              initialFile={selectedFile}
              onClose={() => setSelectedFile(null)}
              onShowActionSheet={handleShowCarouselActions}
              onZoomChange={setIsCarouselZoomed}
              onViewStyleChange={(s) => setIsCarouselDetail(s === 'detail')}
              isDismissing={isDraggingToDismiss}
            />
          </DragToDismiss>
        </Animated.View>
      ) : null}
      {actionSheetFileIds.length > 0 ? (
        <FileActionsSheet
          fileIds={actionSheetFileIds}
          sheetName="fileActions"
          onComplete={isSelectionMode ? handleBulkActionComplete : undefined}
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgCanvas },
  header: {
    paddingHorizontal: 16,
    backgroundColor: 'transparent',
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  topBlur: {
    zIndex: 10,
    pointerEvents: 'none',
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 180,
  },
  headerTitleLarge: {
    color: palette.gray[50],
    fontSize: 32,
    fontWeight: '800',
  },
  headerTitles: { top: 0, flexDirection: 'column' },
  headerSubtitle: {
    color: palette.gray[50],
    fontSize: 14,
    fontWeight: '600',
    marginTop: 4,
  },
  headerIcon: { paddingVertical: 6, paddingHorizontal: 8 },
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
  buttonRow: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  carouselOverlay: {
    zIndex: 100,
  },
})
