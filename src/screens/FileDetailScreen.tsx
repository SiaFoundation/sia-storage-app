import { FileDetails } from '../components/FileDetails'
import { type NativeStackScreenProps } from '@react-navigation/native-stack'
import { type FeedStackParamList } from '../navigation/types'
import { useCallback, useLayoutEffect, useState } from 'react'
import {
  MoreVerticalIcon,
  Share2Icon,
  Trash2Icon,
  CloudOffIcon,
  EraserIcon,
  CloudUploadIcon,
} from 'lucide-react-native'
import Clipboard from '@react-native-clipboard/clipboard'
import { useToast } from '../lib/toastContext'
import { Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { useFiles, useFileDetails } from '../lib/filesContext'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ArrowDownToLineIcon } from 'lucide-react-native'
import { removeFromCache } from '../lib/fileCache'
import { useDownload } from '../lib/downloadManager'
import { extFromMime } from '../lib/fileTypes'
import { useSettings } from '../lib/settingsContext'
import { getOnePinnedObject, useFileStatus } from '../lib/file'
import { encryptionKeyHexToBuffer } from '../lib/encryptionKey'
import { useReuploadFile } from '../lib/uploadManager'

type Props = NativeStackScreenProps<FeedStackParamList, 'FileDetail'>

function HeaderActions({
  isUploaded,
  onShare,
  onMenu,
}: {
  isUploaded: boolean
  onShare: () => void
  onMenu: () => void
}) {
  return (
    <View style={{ flexDirection: 'row', gap: 14 }}>
      {isUploaded && <Share2Icon color="#0969da" size={20} onPress={onShare} />}
      <MoreVerticalIcon color="#0969da" size={20} onPress={onMenu} />
    </View>
  )
}

function createHeaderRight(
  isUploaded: boolean,
  onShare: () => void,
  onDeepLink: () => void,
  onMenu: () => void
) {
  return () => (
    <HeaderActions isUploaded={isUploaded} onShare={onShare} onMenu={onMenu} />
  )
}

export default function FileDetailScreen({ route, navigation }: Props) {
  const toast = useToast()
  const { data: file } = useFileDetails(route.params.id)
  const status = useFileStatus(file ?? undefined)
  const { deleteFile, removeFromNetwork } = useFiles()
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const insets = useSafeAreaInsets()
  const { sdk } = useSettings()

  const handleOpenMenu = useCallback(() => {
    setIsMenuOpen(true)
  }, [])

  const getShareUrl = useCallback(() => {
    if (!file) return
    if (!sdk) return

    const pinnedObject = getOnePinnedObject(file)
    if (!pinnedObject) return
    const key = pinnedObject.key
    if (!key) return
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 1)
    const shareUrl = sdk.objectShareUrl(
      key,
      encryptionKeyHexToBuffer(file.encryptionKey),
      expiresAt
    )
    return `siamobile://new-file?shareUrl=${encodeURIComponent(shareUrl)}`
  }, [file, sdk])

  const handleCopyShareUrl = useCallback(() => {
    if (!file) return
    if (!sdk) return
    const shareUrl = getShareUrl()
    if (!shareUrl) return
    Clipboard.setString(shareUrl)
    toast.show('Share URL copied to clipboard')
  }, [file, sdk, getShareUrl, toast])

  const handleOpenDeepLink = useCallback(() => {
    if (!file) return
    if (!sdk) return

    const shareUrl = getShareUrl()
    if (!shareUrl) return
    Linking.openURL(shareUrl).catch(() => {
      Clipboard.setString(shareUrl)
      toast.show('Deep link copied to clipboard')
    })
  }, [file, sdk, toast, getShareUrl])

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

  const reupload = useReuploadFile()
  const handleReupload = useCallback(async () => {
    if (!file) return
    try {
      await reupload(file.id)
      toast.show('Reuploaded file')
      setIsMenuOpen(false)
    } catch (e) {
      toast.show('Failed to reupload file')
      setIsMenuOpen(false)
    }
  }, [file?.id, toast])

  const handleRemoveFromNetwork = useCallback(async () => {
    if (!file) return
    try {
      await removeFromNetwork(file.id)
      toast.show('Removed from network')
      setIsMenuOpen(false)
    } catch (e) {
      toast.show('Failed to remove from network')
      setIsMenuOpen(false)
    }
  }, [file?.id, toast])

  const isUploaded = status.isUploaded
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: createHeaderRight(
        isUploaded,
        handleCopyShareUrl,
        handleOpenDeepLink,
        handleOpenMenu
      ),
    })
  }, [
    navigation,
    handleCopyShareUrl,
    handleOpenDeepLink,
    handleOpenMenu,
    isUploaded,
  ])

  const handleDownload = useDownload(file)
  return (
    <>
      {file && <FileDetails file={file} />}
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
              onPress={handlePressAndClose(handleReupload)}
            >
              <CloudUploadIcon color="#0969da" size={18} />
              <Text style={styles.sheetRowPrimaryText}>Reupload file</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={styles.sheetRow}
              onPress={handlePressAndClose(handleRemoveCache)}
            >
              <EraserIcon color="#0969da" size={18} />
              <Text style={styles.sheetRowPrimaryText}>Remove from cache</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={styles.sheetRow}
              onPress={handlePressAndClose(handleRemoveFromNetwork)}
            >
              <CloudOffIcon color="#0969da" size={18} />
              <Text style={styles.sheetRowPrimaryText}>
                Remove from network
              </Text>
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
