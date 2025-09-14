import { FlatList, StyleSheet } from 'react-native'
import { useFileList } from '../hooks/files'
import { type FileRecord } from '../db/files'
import { GalleryItem } from './GalleryItem'

type Props = {
  onPressItem: (item: FileRecord) => void
  setItemRef?: (id: string, ref: any) => void
  numColumns?: number
}

export function Gallery({ onPressItem, setItemRef, numColumns = 3 }: Props) {
  const { data: files } = useFileList()
  return (
    <FlatList
      data={files}
      keyExtractor={(item) => item.id}
      numColumns={numColumns}
      contentContainerStyle={styles.galleryContent}
      renderItem={({ item }) => (
        <GalleryItem
          file={item}
          onPressItem={onPressItem}
          setItemRef={setItemRef}
        />
      )}
    />
  )
}

const styles = StyleSheet.create({
  galleryContent: { padding: 0 },
})
