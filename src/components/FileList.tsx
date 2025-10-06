import React, { useCallback } from 'react'
import { FlatList, ActivityIndicator } from 'react-native'
import { FileRecord, useFileList } from '../stores/files'
import { FileListItem } from './FileListItem'
import { useFlatListControls } from '../hooks/useFlatListControls'

type Props = {
  onPressItem: (item: FileRecord) => void
  setItemRef?: (id: string, ref: any) => void
  topPadding?: number
}

export function FileList({ onPressItem, setItemRef, topPadding = 0 }: Props) {
  const { data: files, size, setSize, isValidating, hasMore } = useFileList()
  const { isRefreshing, isLoadingMore, handleEndReached, handleRefresh } =
    useFlatListControls({ data: files, size, setSize, isValidating, hasMore })

  return (
    <FlatList
      data={files ?? []}
      keyExtractor={(item) => item.id}
      contentInsetAdjustmentBehavior="never"
      contentInset={{ top: 0, bottom: 0, left: 0, right: 0 }}
      automaticallyAdjustContentInsets={false}
      automaticallyAdjustKeyboardInsets={false}
      automaticallyAdjustsScrollIndicatorInsets={false}
      contentContainerStyle={{
        paddingTop: topPadding,
        gap: 8,
        paddingBottom: 16,
      }}
      renderItem={({ item }) => (
        <FileListItem
          file={item}
          onPressItem={onPressItem}
          setItemRef={setItemRef}
        />
      )}
      onEndReachedThreshold={0.9}
      onEndReached={handleEndReached}
      refreshing={isRefreshing}
      onRefresh={handleRefresh}
      initialNumToRender={36}
      windowSize={9}
      maxToRenderPerBatch={20}
      updateCellsBatchingPeriod={20}
      ListFooterComponent={isLoadingMore ? <ActivityIndicator /> : null}
      removeClippedSubviews
    />
  )
}
