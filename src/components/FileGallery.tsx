import React from 'react'
import { FlatList, StyleSheet, ActivityIndicator } from 'react-native'
import { useFileList, type FileRecord } from '../stores/files'
import { useFlatListControls } from '../hooks/useFlatListControls'
import { FileGalleryItem } from './FileGalleryItem'

type Props = {
  onPressItem: (item: FileRecord) => void
  setItemRef?: (id: string, ref: any) => void
  numColumns?: number
  topPadding?: number
}

export function FileGallery({
  onPressItem,
  setItemRef,
  numColumns = 3,
  topPadding = 0,
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
      contentContainerStyle={[
        styles.galleryContent,
        { paddingTop: topPadding },
      ]}
      renderItem={({ item }) => (
        <FileGalleryItem
          file={item}
          onPressItem={onPressItem}
          setItemRef={setItemRef}
        />
      )}
      onEndReachedThreshold={0.95}
      onEndReached={handleEndReached}
      initialNumToRender={36}
      windowSize={9}
      maxToRenderPerBatch={20}
      updateCellsBatchingPeriod={20}
      ListFooterComponent={isLoadingMore ? <ActivityIndicator /> : null}
      removeClippedSubviews
    />
  )
}

const styles = StyleSheet.create({
  galleryContent: { padding: 0 },
})
