import { type FileListParams, useFileList } from '@siastorage/core/stores'
import type { FileRecord } from '@siastorage/core/types'
import type React from 'react'
import { useCallback, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  type FlatListProps,
  type LayoutChangeEvent,
  StyleSheet,
  useWindowDimensions,
} from 'react-native'
import { useFlatListControls } from '../hooks/useFlatListControls'
import { galleryColumns } from '../lib/galleryColumns'
import { useHeaderContentOffset } from '../styles/layout'
import { FileGalleryItem } from './FileGalleryItem'

type Props = {
  filters: FileListParams
  onPressItem: (item: FileRecord) => void
  onLongPressItem?: (item: FileRecord) => void
  keyboardDismissMode?: FlatListProps<FileRecord>['keyboardDismissMode']
  contentPaddingTop?: number
  ListHeaderComponent?: React.ReactElement | null
}

export function FileGallery({
  filters,
  onPressItem,
  onLongPressItem,
  keyboardDismissMode,
  contentPaddingTop,
  ListHeaderComponent,
}: Props) {
  const { data: files, size, setSize, isValidating, hasMore } = useFileList(filters)
  const { isLoadingMore, handleEndReached } = useFlatListControls({
    data: files,
    size,
    setSize,
    isValidating,
    hasMore,
  })

  const headerOffset = useHeaderContentOffset()
  const { width: windowWidth } = useWindowDimensions()
  const [width, setWidth] = useState(windowWidth)
  const columns = galleryColumns(width)

  // A FlatList cannot change its column count in place, so a new count remounts
  // it under a new key, which starts it at the top. Folding or unfolding an
  // iPhone Duo changes the count, so the first row on screen is kept and
  // scrolled back to once the new list has laid out.
  const listRef = useRef<FlatList<FileRecord>>(null)
  const firstVisibleIndex = useRef(0)
  const restoreRow = useRef<{ row: number; columns: number } | null>(null)
  const onViewableItemsChanged = useCallback<
    NonNullable<FlatListProps<FileRecord>['onViewableItemsChanged']>
  >(({ viewableItems }) => {
    const index = viewableItems[0]?.index
    if (index != null) firstVisibleIndex.current = index
  }, [])
  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const next = event.nativeEvent.layout.width
      const nextColumns = galleryColumns(next)
      if (nextColumns !== columns) {
        restoreRow.current = {
          row: Math.floor(firstVisibleIndex.current / nextColumns),
          columns: nextColumns,
        }
      }
      setWidth(next)
    },
    [columns],
  )
  const restoreAttempts = useRef(0)
  // The outgoing list reports its own size change before the new one mounts,
  // so the restore waits for a list with the column count it was taken for.
  const handleContentSizeChange = useCallback(
    (_width: number, height: number) => {
      const target = restoreRow.current
      if (!target || target.columns !== columns || height === 0) return
      restoreRow.current = null
      restoreAttempts.current = 0
      if (target.row > 0) listRef.current?.scrollToIndex({ index: target.row, animated: false })
    },
    [columns],
  )
  // The new list has measured no rows yet, so the first scroll can land short.
  // It moves by the average row height so far, and tries again once more rows
  // have been measured.
  const handleScrollToIndexFailed = useCallback(
    (info: { index: number; averageItemLength: number }) => {
      const list = listRef.current
      list?.scrollToOffset({
        offset: info.index * info.averageItemLength,
        animated: false,
      })
      if (list && restoreAttempts.current++ < 3) {
        setTimeout(() => {
          // A fold during the wait remounts the list, whose rows are numbered
          // for another column count, and it restores its own position.
          if (listRef.current === list) list.scrollToIndex({ index: info.index, animated: false })
        }, 100)
      }
    },
    [],
  )

  const renderItem = useCallback(
    ({ item }: { item: FileRecord }) => {
      return (
        <FileGalleryItem
          file={item}
          onPressItem={onPressItem}
          onLongPressItem={onLongPressItem}
          columns={columns}
        />
      )
    },
    [onPressItem, onLongPressItem, columns],
  )

  return (
    <FlatList
      ref={listRef}
      key={`columns-${columns}`}
      data={files ?? []}
      keyExtractor={(item) => item.id}
      numColumns={columns}
      onLayout={handleLayout}
      onViewableItemsChanged={onViewableItemsChanged}
      onContentSizeChange={handleContentSizeChange}
      onScrollToIndexFailed={handleScrollToIndexFailed}
      contentInsetAdjustmentBehavior="never"
      contentInset={{ top: 0, bottom: 0, left: 0, right: 0 }}
      automaticallyAdjustContentInsets={false}
      automaticallyAdjustKeyboardInsets={false}
      automaticallyAdjustsScrollIndicatorInsets={false}
      contentContainerStyle={[
        styles.galleryContent,
        { paddingTop: contentPaddingTop || headerOffset },
      ]}
      ListHeaderComponent={ListHeaderComponent ?? undefined}
      renderItem={renderItem}
      onEndReachedThreshold={0.95}
      onEndReached={handleEndReached}
      initialNumToRender={36}
      windowSize={9}
      maxToRenderPerBatch={20}
      updateCellsBatchingPeriod={20}
      showsVerticalScrollIndicator={false}
      keyboardDismissMode={keyboardDismissMode}
      ListFooterComponent={isLoadingMore ? <ActivityIndicator /> : undefined}
      removeClippedSubviews
    />
  )
}

const styles = StyleSheet.create({
  galleryContent: {
    paddingBottom: 130,
  },
})
