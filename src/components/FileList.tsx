import React from 'react'
import { FlatList, ActivityIndicator } from 'react-native'
import { FileRecord } from '../stores/files'
import { useFileList } from '../stores/library'
import { FileListItem } from './FileListItem'
import { useFlatListControls } from '../hooks/useFlatListControls'

type Props = {
  onPressItem: (item: FileRecord) => void
}

export function FileList({ onPressItem }: Props) {
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
      contentInsetAdjustmentBehavior="never"
      contentInset={{ top: 0, bottom: 0, left: 0, right: 0 }}
      automaticallyAdjustContentInsets={false}
      automaticallyAdjustKeyboardInsets={false}
      automaticallyAdjustsScrollIndicatorInsets={false}
      contentContainerStyle={{
        paddingTop: 130,
        gap: 8,
        paddingBottom: 130,
      }}
      renderItem={({ item }) => (
        <FileListItem file={item} onPressItem={onPressItem} />
      )}
      onEndReachedThreshold={0.9}
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
