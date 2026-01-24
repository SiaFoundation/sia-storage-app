import React from 'react'
import { FlatList, StyleSheet, ActivityIndicator, Platform } from 'react-native'
import { type FileRecord } from '../stores/files'
import { useFileList } from '../stores/library'
import { useFlatListControls } from '../hooks/useFlatListControls'
import { FileGalleryItem } from './FileGalleryItem'

type Props = {
  onPressItem: (item: FileRecord) => void
  onLongPressItem?: (item: FileRecord) => void
  numColumns?: number
  isSelectionMode?: boolean
  selectedFileIds?: Set<string>
}

export function FileGallery({
  onPressItem,
  onLongPressItem,
  numColumns = 3,
  isSelectionMode = false,
  selectedFileIds,
}: Props) {
  const { data: files, size, setSize, isValidating, hasMore } = useFileList()
  const { isLoadingMore, handleEndReached } = useFlatListControls({
    data: files,
    size,
    setSize,
    isValidating,
    hasMore,
  })

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
      contentContainerStyle={styles.galleryContent}
      renderItem={({ item }) => (
        <FileGalleryItem
          file={item}
          onPressItem={onPressItem}
          onLongPressItem={onLongPressItem}
          isSelectionMode={isSelectionMode}
          isSelected={selectedFileIds?.has(item.id) ?? false}
        />
      )}
      onEndReachedThreshold={0.95}
      onEndReached={handleEndReached}
      initialNumToRender={36}
      windowSize={9}
      maxToRenderPerBatch={20}
      updateCellsBatchingPeriod={20}
      showsVerticalScrollIndicator={false}
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
