import { type FileListParams, useFileList } from '@siastorage/core/stores'
import type { FileRecord } from '@siastorage/core/types'
import { useCallback } from 'react'
import {
  ActivityIndicator,
  FlatList,
  type FlatListProps,
  Platform,
} from 'react-native'
import { useFlatListControls } from '../hooks/useFlatListControls'
import { FileListItem } from './FileListItem'

type Props = {
  filters: FileListParams
  onPressItem: (item: FileRecord) => void
  onLongPressItem?: (item: FileRecord) => void
  keyboardDismissMode?: FlatListProps<FileRecord>['keyboardDismissMode']
}

export function FileList({
  filters,
  onPressItem,
  onLongPressItem,
  keyboardDismissMode,
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
      keyboardDismissMode={keyboardDismissMode}
      ListFooterComponent={isLoadingMore ? <ActivityIndicator /> : null}
      removeClippedSubviews
    />
  )
}
