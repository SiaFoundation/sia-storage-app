import { useCallback } from 'react'
import { ActivityIndicator, FlatList, Platform } from 'react-native'
import { useFlatListControls } from '../hooks/useFlatListControls'
import type { FileRecord } from '../stores/files'
import { useFileList } from '../stores/library'
import { FileListItem } from './FileListItem'

type Props = {
  onPressItem: (item: FileRecord) => void
  onLongPressItem?: (item: FileRecord) => void
}

export function FileList({ onPressItem, onLongPressItem }: Props) {
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
        <FileListItem
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
      contentInsetAdjustmentBehavior="never"
      contentInset={{ top: 0, bottom: 0, left: 0, right: 0 }}
      automaticallyAdjustContentInsets={false}
      automaticallyAdjustKeyboardInsets={false}
      automaticallyAdjustsScrollIndicatorInsets={false}
      contentContainerStyle={{
        paddingTop: Platform.OS === 'android' ? 150 : 130,
        gap: 8,
        paddingBottom: 130,
      }}
      renderItem={renderItem}
      onEndReachedThreshold={0.9}
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
