import React, { useCallback } from 'react'
import { FlatList, StyleSheet, ActivityIndicator } from 'react-native'
import { useFileList, type FileRecord } from '../stores/files'
import { GalleryItem } from './GalleryItem'

type Props = {
  onPressItem: (item: FileRecord) => void
  setItemRef?: (id: string, ref: any) => void
  numColumns?: number
  topPadding?: number
}

export function Gallery({
  onPressItem,
  setItemRef,
  numColumns = 3,
  topPadding = 0,
}: Props) {
  const { data: files, size, setSize, isValidating, hasMore } = useFileList()

  const isRefreshing = !!files && isValidating && size === 1
  const isLoadingMore = !!files && isValidating && hasMore

  const handleEndReached = useCallback(() => {
    if (!isLoadingMore && hasMore) setSize(size + 1)
  }, [isLoadingMore, hasMore, setSize, size])

  const handleRefresh = useCallback(() => {
    setSize(1)
  }, [setSize])

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
        <GalleryItem
          file={item}
          onPressItem={onPressItem}
          setItemRef={setItemRef}
        />
      )}
      onEndReachedThreshold={0.5}
      onEndReached={handleEndReached}
      refreshing={isRefreshing}
      onRefresh={handleRefresh}
      ListFooterComponent={isLoadingMore ? <ActivityIndicator /> : null}
      removeClippedSubviews
      windowSize={5}
      initialNumToRender={30}
    />
  )
}

const styles = StyleSheet.create({
  galleryContent: { padding: 0 },
})
