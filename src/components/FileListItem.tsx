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
}

function FileListItemComponent({ file, onPressItem }: Props) {
  const status = useFileStatus(file)
  return (
    <Pressable
      collapsable={false}
      style={styles.container}
      onPress={() => onPressItem(file)}
    >
      <View style={styles.thumbnailContainer}>
        <FileThumbnail file={file} thumbSize={64} />
      </View>
      <View style={styles.infoContainer}>
        <View style={styles.fileDetails}>
          <Text style={styles.fileName} numberOfLines={1} ellipsizeMode="tail">
            {file.name}
          </Text>
          <View style={styles.fileMetaData}>
            {status.data ? (
              <>
                <UploadStatusIcon
                  size={12}
                  status={status.data}
                  color="gray"
                  variant="icon"
                />
                <DotIcon size={16} color="grey" />
              </>
            ) : null}
            <Text style={styles.fileText}>{humanSize(file.size)}</Text>
            <DotIcon size={16} color="grey" />
            <Text style={styles.fileText}>{file.type}</Text>
          </View>
        </View>
      </View>
      <View pointerEvents="box-none" style={styles.trailing}></View>
    </Pressable>
  )
}

export const FileListItem = memo(FileListItemComponent, (prev, next) => {
  return (
    prev.file.id === next.file.id &&
    prev.file.updatedAt === next.file.updatedAt &&
    prev.onPressItem === next.onPressItem
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
