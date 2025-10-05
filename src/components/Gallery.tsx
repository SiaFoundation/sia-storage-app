import { FlatList, StyleSheet } from 'react-native'
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
  const { data: files } = useFileList()
  return (
    <FlatList
      data={files}
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
    />
  )
}

const styles = StyleSheet.create({
  galleryContent: { padding: 0 },
})
