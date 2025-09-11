import { FileDetails } from '../components/FileDetails'
import { type NativeStackScreenProps } from '@react-navigation/native-stack'
import { type FeedStackParamList } from '../navigation/types'
import { useCallback, useLayoutEffect, useState } from 'react'
import { Share2Icon, MoreVerticalIcon, Trash2Icon } from 'lucide-react-native'
import Clipboard from '@react-native-clipboard/clipboard'
import { useToast } from '../lib/toastContext'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { useFiles, useFileDetails } from '../lib/filesContext'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ArrowDownToLineIcon } from 'lucide-react-native'
import { removeFromCache } from '../lib/fileCache'
import { useDownload } from '../lib/downloadManager'
import { extFromMime } from '../lib/fileTypes'

type Props = NativeStackScreenProps<FeedStackParamList, 'FileDetail'>

function HeaderActions({
  onShare,
  onMenu,
}: {
  onShare: () => void
  onMenu: () => void
}) {
  return (
    <View style={{ flexDirection: 'row', gap: 14 }}>
      <Share2Icon color="#0969da" size={20} onPress={onShare} />
      <MoreVerticalIcon color="#0969da" size={20} onPress={onMenu} />
    </View>
  )
}

function createHeaderRight(onShare: () => void, onMenu: () => void) {
  return () => <HeaderActions onShare={onShare} onMenu={onMenu} />
}

export default function FileDetailScreen({ route, navigation }: Props) {
  const toast = useToast()
  const { data: file } = useFileDetails(route.params.id)
  const { deleteFile } = useFiles()
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const insets = useSafeAreaInsets()

  const handleShare = useCallback(() => {
    if (!file) return
    Clipboard.setString(file.id)
    toast.show('Copied item id')
  }, [file?.id, toast])

  const handleOpenMenu = useCallback(() => {
    setIsMenuOpen(true)
  }, [])

  const closeMenu = useCallback(() => {
    setIsMenuOpen(false)
  }, [])

  const handlePressAndClose = useCallback(
    (action: () => void | Promise<void>) => () => {
      setIsMenuOpen(false)
      void action()
    },
    [setIsMenuOpen]
  )

  const handleDelete = useCallback(async () => {
    if (!file) return
    try {
      await deleteFile(file.id)
      toast.show('Deleted file')
      setIsMenuOpen(false)
      navigation.goBack()
    } catch (e) {
      toast.show('Failed to delete file')
      setIsMenuOpen(false)
    }
  }, [deleteFile, file?.id, navigation, toast])

  const handleRemoveCache = useCallback(async () => {
    if (!file) return
    try {
      await removeFromCache(file.id, extFromMime(file.fileType))
      toast.show('Removed from cache')
      setIsMenuOpen(false)
    } catch (e) {
      toast.show('Failed to remove cache')
      setIsMenuOpen(false)
    }
  }, [file?.id, file?.fileType, toast])

  const handleDownload = useDownload(file)

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: createHeaderRight(handleShare, handleOpenMenu),
    })
  }, [navigation, handleShare, handleOpenMenu])

  return (
    <>
      {file && <FileDetails file={file} onDownload={handleDownload} />}
      <Modal
        visible={isMenuOpen}
        transparent
        animationType="fade"
        onRequestClose={closeMenu}
      >
        <Pressable style={styles.backdrop} onPress={closeMenu}>
          <View
            style={[
              styles.sheet,
              { paddingBottom: Math.max(16, insets.bottom + 12) },
            ]}
          >
            <Pressable
              accessibilityRole="button"
              style={styles.sheetRow}
              onPress={handlePressAndClose(handleDownload)}
            >
              <ArrowDownToLineIcon color="#0969da" size={18} />
              <Text style={styles.sheetRowPrimaryText}>Download file</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={styles.sheetRow}
              onPress={handlePressAndClose(handleRemoveCache)}
            >
              <ArrowDownToLineIcon color="#0969da" size={18} />
              <Text style={styles.sheetRowPrimaryText}>Remove from cache</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={styles.sheetRow}
              onPress={handlePressAndClose(handleDelete)}
            >
              <Trash2Icon color="#c83532" size={18} />
              <Text style={styles.sheetRowDangerText}>Delete file</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: 'white',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 6,
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 10,
  },
  sheetRowText: {
    fontSize: 16,
  },
  sheetRowPrimaryText: {
    fontSize: 16,
    color: '#0969da',
  },
  sheetRowDangerText: {
    fontSize: 16,
    color: '#c83532',
  },
})
