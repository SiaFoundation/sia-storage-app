import { FlatList, StyleSheet } from 'react-native'
import { useOrderedFileList, type FileRecord } from '../stores/files'
import { GalleryItem } from './GalleryItem'

type Props = {
  onPressItem: (item: FileRecord) => void
  setItemRef?: (id: string, ref: any) => void
  numColumns?: number
}

export function Gallery({ onPressItem, setItemRef, numColumns = 3 }: Props) {
  const { data: files } = useOrderedFileList()
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
