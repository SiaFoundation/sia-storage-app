import { FlatList } from 'react-native'
import { FileRecord, useFileList } from '../stores/files'
import { FileListItem } from './FileListItem'

type Props = {
  onPressItem: (item: FileRecord) => void
  setItemRef?: (id: string, ref: any) => void
  topPadding?: number
}

export function FileList({ onPressItem, setItemRef, topPadding = 0 }: Props) {
  const { data: files } = useFileList()
  return (
    <FlatList
      data={files}
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
    />
  )
}
