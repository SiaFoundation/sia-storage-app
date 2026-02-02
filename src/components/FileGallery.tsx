import { useCallback } from 'react'
import { ActivityIndicator, FlatList, Platform, StyleSheet } from 'react-native'
import { useFlatListControls } from '../hooks/useFlatListControls'
import type { FileRecord } from '../stores/files'
import { useFileList } from '../stores/library'
import { FileGalleryItem } from './FileGalleryItem'

type Props = {
  onPressItem: (item: FileRecord) => void
  onLongPressItem?: (item: FileRecord) => void
  numColumns?: number
}

export function FileGallery({
  onPressItem,
  onLongPressItem,
  numColumns = 3,
}: Props) {
  const { data: files, size, setSize, isValidating, hasMore } = useFileList()
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
      contentContainerStyle={styles.galleryContent}
      renderItem={renderItem}
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
