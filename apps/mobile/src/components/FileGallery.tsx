import { type FileListParams, useFileList } from '@siastorage/core/stores'
import type { FileRecord } from '@siastorage/core/types'
import type React from 'react'
import { useCallback } from 'react'
import {
  ActivityIndicator,
  FlatList,
  type FlatListProps,
  Platform,
  StyleSheet,
} from 'react-native'
import { useFlatListControls } from '../hooks/useFlatListControls'
import { FileGalleryItem } from './FileGalleryItem'

type Props = {
  filters: FileListParams
  onPressItem: (item: FileRecord) => void
  onLongPressItem?: (item: FileRecord) => void
  numColumns?: number
  keyboardDismissMode?: FlatListProps<FileRecord>['keyboardDismissMode']
  contentPaddingTop?: number
  ListHeaderComponent?: React.ReactElement | null
}

export function FileGallery({
  filters,
  onPressItem,
  onLongPressItem,
  numColumns = 3,
  keyboardDismissMode,
  contentPaddingTop,
  ListHeaderComponent,
}: Props) {
  const {
    data: files,
    size,
    setSize,
    isValidating,
    hasMore,
  } = useFileList(filters)
  const { isLoadingMore, handleEndReached } = useFlatListControls({
    data: files,
    size,
    setSize,
    isValidating,
    hasMore,
  })

  const renderItem = useCallback(
    ({ item }: { item: FileRecord }) => {
      return (
        <FileGalleryItem
          file={item}
          onPressItem={onPressItem}
          onLongPressItem={onLongPressItem}
        />
      )
    },
    [onPressItem, onLongPressItem],
  )

  return (
    <FlatList
      data={files ?? []}
      keyExtractor={(item) => item.id}
      numColumns={numColumns}
      contentInsetAdjustmentBehavior="never"
      contentInset={{ top: 0, bottom: 0, left: 0, right: 0 }}
      automaticallyAdjustContentInsets={false}
      automaticallyAdjustKeyboardInsets={false}
      automaticallyAdjustsScrollIndicatorInsets={false}
      contentContainerStyle={
        contentPaddingTop
          ? { ...styles.galleryContent, paddingTop: contentPaddingTop }
          : styles.galleryContent
      }
      ListHeaderComponent={ListHeaderComponent}
      renderItem={renderItem}
      onEndReachedThreshold={0.95}
      onEndReached={handleEndReached}
      initialNumToRender={36}
      windowSize={9}
      maxToRenderPerBatch={20}
      updateCellsBatchingPeriod={20}
      showsVerticalScrollIndicator={false}
      keyboardDismissMode={keyboardDismissMode}
      ListFooterComponent={isLoadingMore ? <ActivityIndicator /> : null}
      removeClippedSubviews
    />
  )
}

const styles = StyleSheet.create({
  galleryContent: {
    paddingTop: Platform.OS === 'android' ? 150 : 130,
    paddingBottom: 130,
  },
})
