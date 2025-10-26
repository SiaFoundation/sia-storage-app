import { Pressable, StyleSheet, Text, View } from 'react-native'
import { whiteA, palette } from '../styles/colors'
import { FileRecord } from '../stores/files'
import { useFileStatus } from '../lib/file'
import { humanSize } from '../lib/humanSize'
import { DotIcon } from 'lucide-react-native'
import { UploadStatusIcon } from './UploadStatusIcon'
import { FileThumbnail } from './FileThumbnail'
import { memo } from 'react'

type Props = {
  file: FileRecord
  onPressItem: (item: FileRecord) => void
  setItemRef?: (id: string, ref: any) => void
}

function FileListItemComponent({ file, onPressItem, setItemRef }: Props) {
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
            {status.data ? (
              <>
                <UploadStatusIcon
                  size={12}
                  status={status.data}
                  interactive={false}
                  color="gray"
                  variant="icon"
                />
                <DotIcon size={16} color="grey" />
              </>
            ) : null}
            <Text style={styles.fileText}>{humanSize(file.fileSize)}</Text>
            <DotIcon size={16} color="grey" />
            <Text style={styles.fileText}>{file.fileType}</Text>
          </View>
        </View>
      </View>
      <View pointerEvents="box-none" style={styles.trailing}></View>
    </Pressable>
  )
}

export const FileListItem = memo(FileListItemComponent, (prev, next) => {
  return (
    prev.file === next.file &&
    prev.onPressItem === next.onPressItem &&
    prev.setItemRef === next.setItemRef
  )
})

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    display: 'flex',
    flexDirection: 'row',
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: whiteA.a10,
    paddingBottom: 8,
    width: '100%',
    paddingRight: 24,
    overflow: 'hidden',
  },
  thumbnailContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.gray[700],
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
    color: palette.gray[50],
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
