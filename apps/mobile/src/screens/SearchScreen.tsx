import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { type FileListParams, useAllTags, useFileList } from '@siastorage/core/stores'
import type { FileRecord } from '@siastorage/core/types'
import { ArrowLeftIcon, ListFilterIcon, SearchIcon, XIcon } from 'lucide-react-native'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Animated,
  Keyboard,
  type KeyboardEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { DragToDismiss } from '../components/DragToDismiss'
import { useBackClose } from '../hooks/useBackClose'
import { EmptyState } from '../components/EmptyState'
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
import { TagPill } from '../components/TagPill'
import { ViewSettingsMenu } from '../components/ViewSettingsMenu'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import type { MainStackParamList } from '../stacks/types'
import {
  enterSelectionMode,
  exitSelectionMode,
  toggleFileSelection,
  useIsSelectionMode,
  useSelectedFileIds,
} from '../stores/fileSelection'
import { openSheet } from '../stores/sheets'
import { useViewSettings } from '../stores/viewSettings'
import { colors, overlay, palette, whiteA } from '../styles/colors'

type Props = NativeStackScreenProps<MainStackParamList, 'Search'>

export function SearchScreen({ navigation }: Props) {
  const vs = useViewSettings('search')
  const allTags = useAllTags()
  const tags = allTags.data ?? []
  const [text, setText] = useState('')
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set())
  const inputRef = useRef<TextInput | null>(null)
  const debounced = useDebouncedValue(text, 300)
  const isSelectionMode = useIsSelectionMode()
  const isSelectionModeRef = useRef(isSelectionMode)
  const selectedFileIds = useSelectedFileIds()
  const insets = useSafeAreaInsets()
  const filters: FileListParams = useMemo(
    () => ({
      scope: 'search',
      sortBy: vs.sortBy,
      sortDir: vs.sortDir,
      categories: vs.selectedCategories,
      query: debounced,
      tags: Array.from(selectedTags),
    }),
    [vs.sortBy, vs.sortDir, vs.selectedCategories, debounced, selectedTags],
  )
  const files = useFileList(filters)
  const [keyboardOffset, setKeyboardOffset] = useState(0)

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
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'

    const handleShow = (e: KeyboardEvent) => {
      const height = e.endCoordinates?.height ?? 0
      // On Android with edge-to-edge, the reported keyboard height may
      // not include the IME toolbar (clipboard, voice, etc.) above the
      // keyboard. Add the bottom inset to compensate.
      setKeyboardOffset(Platform.OS === 'android' ? height + insets.bottom : height)
    }
    const handleHide = () => {
      setKeyboardOffset(0)
    }

    const showSub = Keyboard.addListener(showEvent, handleShow)
    const hideSub = Keyboard.addListener(hideEvent, handleHide)

    return () => {
      showSub.remove()
      hideSub.remove()
    }
  }, [insets.bottom])

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
    }
  }, [selectedFile, fadeAnim, scaleAnim])

  const handlePressItem = useCallback((file: FileRecord) => {
    Keyboard.dismiss()
    if (isSelectionModeRef.current) {
      toggleFileSelection(file.id)
    } else {
      setActionFileId(null)
      setSelectedFile(file)
    }
  }, [])

  const handleLongPressItem = useCallback((file: FileRecord) => {
    Keyboard.dismiss()
    if (isSelectionModeRef.current) {
      toggleFileSelection(file.id)
      return
    }
    setActionFileId(file.id)
    openSheet('searchFileActions')
  }, [])

  const handleCloseCarousel = useCallback(() => {
    setSelectedFile(null)
    setIsCarouselZoomed(false)
    setIsCarouselDetail(false)
  }, [])

  useBackClose(!!selectedFile, handleCloseCarousel)

  const handleBulkActionComplete = useCallback(() => {
    exitSelectionMode()
  }, [])

  const handleExit = useCallback(() => {
    navigation.goBack()
  }, [navigation])

  const selectedTagObjects = tags.filter((t) => selectedTags.has(t.id))

  const tagSuggestions =
    text.trim().length > 0
      ? tags.filter(
          (t) =>
            !selectedTags.has(t.id) && t.name.toLowerCase().includes(text.trim().toLowerCase()),
        )
      : []

  const toggleTag = useCallback((tagId: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev)
      if (next.has(tagId)) next.delete(tagId)
      else next.add(tagId)
      return next
    })
  }, [])

  const handleSelectTagSuggestion = useCallback(
    (tagId: string) => {
      toggleTag(tagId)
      setText('')
    },
    [toggleTag],
  )

  const hasQuery = debounced.trim().length > 0 || selectedTags.size > 0
  const noResults = hasQuery && files.data?.length === 0 && !files.isLoading

  const actionSheetFileIds = isSelectionMode
    ? selectedFileIds
    : selectedFile
      ? [selectedFile.id]
      : actionFileId
        ? [actionFileId]
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
        <View style={styles.headerLeft}>
          <IconButton onPress={handleExit} accessibilityLabel="Back">
            <ArrowLeftIcon color={palette.gray[50]} size={22} />
          </IconButton>
          <Text style={styles.titleLarge} pointerEvents="none">
            Search
          </Text>
        </View>
        <View style={styles.buttonRow}>
          <ViewSettingsMenu scope="search">
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

      {noResults ? (
        <Pressable style={styles.emptyPressable} onPress={() => Keyboard.dismiss()}>
          <EmptyState
            image={require('../../assets/image-stack.png')}
            title="No results found"
            message="Try a different search term or filter."
          />
        </Pressable>
      ) : vs.viewMode === 'gallery' ? (
        <FileGallery
          filters={filters}
          onPressItem={handlePressItem}
          onLongPressItem={handleLongPressItem}
          keyboardDismissMode="on-drag"
        />
      ) : (
        <FileList
          filters={filters}
          onPressItem={handlePressItem}
          onLongPressItem={handleLongPressItem}
          keyboardDismissMode="on-drag"
        />
      )}

      <Gradient
        fadeTo="bottom"
        overlayTopColor={overlay.gradientLight}
        overlayBottomColor={overlay.gradientDark}
        style={styles.bottomGradient}
      />
      {isSelectionMode ? (
        <SelectionBar
          onComplete={handleBulkActionComplete}
          moveToDirectorySheet="searchMoveToDir"
        />
      ) : (
        <View
          style={[
            styles.searchBarAbsolute,
            { bottom: keyboardOffset > 0 ? keyboardOffset : insets.bottom },
          ]}
        >
          {tagSuggestions.length > 0 ? (
            <View style={styles.suggestions}>
              {tagSuggestions.map((tag) => (
                <Pressable
                  key={tag.id}
                  style={styles.suggestionPill}
                  onPress={() => handleSelectTagSuggestion(tag.id)}
                >
                  <Text style={styles.suggestionText}>{tag.name}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <View style={styles.searchBar}>
            <SearchIcon color={whiteA.a70} size={18} />
            {selectedTagObjects.map((tag) => (
              <TagPill key={tag.id} tag={tag} selected onRemove={() => toggleTag(tag.id)} />
            ))}
            <TextInput
              ref={inputRef}
              value={text}
              onChangeText={setText}
              placeholder="Search files..."
              placeholderTextColor={whiteA.a50}
              style={styles.input}
              autoCapitalize="none"
              returnKeyType="search"
              onSubmitEditing={() => Keyboard.dismiss()}
              onKeyPress={(e) => {
                if (e.nativeEvent.key === 'Backspace' && text === '' && selectedTags.size > 0) {
                  const lastTag = Array.from(selectedTags).pop()
                  if (lastTag) toggleTag(lastTag)
                }
              }}
              autoFocus
            />
            <Pressable accessibilityRole="button" onPress={handleExit} hitSlop={8}>
              <XIcon size={18} color={whiteA.a70} />
            </Pressable>
          </View>
        </View>
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
              query={debounced}
              tags={Array.from(selectedTags)}
              onClose={handleCloseCarousel}
              onShowActionSheet={() => openSheet('searchFileActions')}
              onShowTagSheet={() => openSheet('searchManageTags')}
              onMoveToDirectory={() => openSheet('searchMoveToDir')}
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
            sheetName="searchFileActions"
            manageTagsSheet="searchManageTags"
            moveToDirectorySheet="searchMoveToDir"
            onComplete={isSelectionMode ? handleBulkActionComplete : undefined}
          />
          {actionSheetFileIds.length === 1 ? (
            <ManageTagsSheet fileId={actionSheetFileIds[0]} sheetName="searchManageTags" />
          ) : null}
        </>
      ) : null}
      <MoveToDirectorySheet
        fileIds={actionSheetFileIds}
        sheetName="searchMoveToDir"
        onComplete={isSelectionMode ? handleBulkActionComplete : undefined}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgCanvas,
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
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  titleLarge: {
    color: palette.gray[50],
    fontSize: 32,
    fontWeight: '800',
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
  bottomGradient: {
    zIndex: 10,
    pointerEvents: 'none',
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 120,
  },
  searchBarAbsolute: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 48,
    borderRadius: 24,
    backgroundColor: overlay.panelStrong,
    paddingHorizontal: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: whiteA.a08,
    shadowColor: palette.gray[950],
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 28,
  },
  input: {
    flex: 1,
    color: palette.gray[50],
    paddingVertical: 0,
    fontSize: 15,
  },
  emptyPressable: {
    flex: 1,
  },
  suggestions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 4,
    paddingBottom: 8,
  },
  suggestionPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: overlay.panelStrong,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: whiteA.a10,
  },
  suggestionText: {
    color: palette.gray[50],
    fontSize: 13,
    fontWeight: '500',
  },
  carouselOverlay: {
    zIndex: 100,
  },
})
