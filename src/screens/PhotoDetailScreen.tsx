import PhotoDetail from '../components/PhotoDetail'
import { type NativeStackScreenProps } from '@react-navigation/native-stack'
import { type FeedStackParamList } from '../navigation/types'
import { useCallback, useLayoutEffect, useState } from 'react'
import { Share2Icon, MoreVerticalIcon, Trash2Icon } from 'lucide-react-native'
import Clipboard from '@react-native-clipboard/clipboard'
import { useToast } from '../lib/toastContext'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { useFiles } from '../lib/filesContext'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

type Props = NativeStackScreenProps<FeedStackParamList, 'PhotoDetail'>

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

export default function PhotoDetailScreen({ route, navigation }: Props) {
  const { item } = route.params
  const toast = useToast()
  const { deleteFile } = useFiles()
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const insets = useSafeAreaInsets()

  const handleShare = useCallback(() => {
    Clipboard.setString(item.id)
    toast.show('Copied photo id')
  }, [item.id, toast])

  const handleOpenMenu = useCallback(() => {
    setIsMenuOpen(true)
  }, [])

  const closeMenu = useCallback(() => {
    setIsMenuOpen(false)
  }, [])

  const handleDelete = useCallback(async () => {
    try {
      await deleteFile(item.id)
      toast.show('Deleted file')
      setIsMenuOpen(false)
      navigation.goBack()
    } catch (e) {
      toast.show('Failed to delete file')
      setIsMenuOpen(false)
    }
  }, [deleteFile, item.id, navigation, toast])

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: createHeaderRight(handleShare, handleOpenMenu),
    })
  }, [navigation, handleShare, handleOpenMenu])

  return (
    <>
      <PhotoDetail item={item} />
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
              onPress={handleDelete}
            >
              <Trash2Icon color="#c83532" size={18} />
              <Text style={styles.sheetRowText}>Delete file</Text>
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
    color: '#ff3b30',
  },
})
