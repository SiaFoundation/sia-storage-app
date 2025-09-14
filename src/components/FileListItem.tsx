import { Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { FileRecord } from '../stores/files'
import { useFileStatus } from '../lib/file'
import { humanSize } from '../lib/humanSize'
import { CloudIcon, DotIcon, PlayIcon } from 'lucide-react-native'
import { UploadStatusIcon } from './UploadStatusIcon'

type Props = {
  file: FileRecord
  onPressItem: (item: FileRecord) => void
  setItemRef?: (id: string, ref: any) => void
}

export function FileListItem({ file, onPressItem, setItemRef }: Props) {
  const status = useFileStatus(file)
  return (
    <Pressable
      collapsable={false}
      ref={(node) => setItemRef?.(file.id, node)}
      style={styles.row}
      onPress={() => onPressItem(file)}
    >
      <View style={styles.thumbnailContainer}>
        {file.fileType?.includes('image') ? (
          <Image
            style={styles.thumbnailImage}
            source={{ uri: status.cachedUri! }}
            resizeMode="center"
          />
        ) : (
          <PlayIcon size={16} />
        )}
      </View>
      <View style={styles.infoRow}>
        <View style={styles.fileDetails}>
          <Text style={styles.fileText}>{file.fileName}</Text>
          <View style={styles.fileMetaData}>
            <Text style={[styles.fileText, styles.gray]}>
              {humanSize(file.fileSize)}
            </Text>
            <DotIcon size={16} color="grey" />
            <Text style={[styles.fileText, styles.gray]}>{file.fileType}</Text>
          </View>
        </View>
        <View pointerEvents="box-none">
          <UploadStatusIcon size={16} status={status} />
        </View>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    marginHorizontal: 9,
    display: 'flex',
    flexDirection: 'row',
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: 'lightgrey',
    paddingBottom: 8,
  },
  thumbnailContainer: {
    width: 32,
    height: 32,
  },
  infoRow: {
    flexGrow: 1,

    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
    borderRadius: 4,
  },
  fileText: {
    fontSize: 10,
  },
  fileDetails: {
    display: 'flex',
    gap: 2,
    justifyContent: 'center',
  },
  fileMetaData: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
  },
  gray: {
    color: 'gray',
  },
})
