import { FlatList, Text } from 'react-native'
import { FileRecord } from '../db/files'
import { useFileList } from '../lib/filesContext'
import { FileListItem } from './FileListItem'

type Props = {
  onPressItem: (item: FileRecord) => void
  setItemRef?: (id: string, ref: any) => void
}

export function FileList({ onPressItem, setItemRef }: Props) {
  const { data: files } = useFileList()
  return (
    <FlatList
      data={files}
      keyExtractor={(item) => item.id}
      contentContainerStyle={{
        padding: 0,
        gap: 8,
        paddingVertical: 8,
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
