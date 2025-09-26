import { Pressable, StyleSheet, Text, View } from 'react-native'
import { FileRecord } from '../stores/files'
import { useFileStatus } from '../lib/file'
import { humanSize } from '../lib/humanSize'
import { DotIcon } from 'lucide-react-native'
import { UploadStatusIcon } from './UploadStatusIcon'
import { FileThumbnail } from './FileThumbnail'

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
      style={styles.container}
      onPress={() => onPressItem(file)}
    >
      <View style={styles.thumbnailContainer}>
        <FileThumbnail file={file} />
      </View>
      <View style={styles.infoContainer}>
        <View style={styles.fileDetails}>
          <Text style={styles.fileName} numberOfLines={1} ellipsizeMode="tail">
            {file.fileName}
          </Text>
          <View style={styles.fileMetaData}>
            <Text style={styles.fileText}>{humanSize(file.fileSize)}</Text>
            <DotIcon size={16} color="grey" />
            <Text style={styles.fileText}>{file.fileType}</Text>
          </View>
        </View>
      </View>
      <View pointerEvents="box-none" style={styles.trailing}>
        <UploadStatusIcon size={16} status={status} interactive={false} />
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 9,
    display: 'flex',
    flexDirection: 'row',
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.1)',
    paddingBottom: 8,
    width: '100%',
    overflow: 'hidden',
    paddingRight: 12,
  },
  thumbnailContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.2)',
    overflow: 'hidden',
  },
  infoContainer: {
    flexGrow: 1,
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'center',
    overflow: 'hidden',
  },
  fileText: { fontSize: 10, color: 'gray' },
  fileName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#24292f',
    overflow: 'hidden',
  },
  fileDetails: {
    display: 'flex',
    gap: 2,
    justifyContent: 'center',
    overflow: 'hidden',
    flex: 1,
  },
  fileMetaData: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  trailing: {
    paddingLeft: 8,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
})
