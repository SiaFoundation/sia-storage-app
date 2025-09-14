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
import { Linking, View } from 'react-native'
import { ArrowDownToLineIcon } from 'lucide-react-native'
import { removeFromCache } from '../lib/fileCache'
import { useDownload } from '../lib/downloadManager'
import { extFromMime } from '../lib/fileTypes'
import { useSettings } from '../lib/settingsContext'
import { getOnePinnedObject, useFileStatus } from '../lib/file'
import { encryptionKeyHexToBuffer } from '../lib/encryptionKey'
import { useReuploadFile } from '../lib/uploadManager'
import { ActionSheetButton } from './ActionSheetButton'
import { ActionSheet } from './ActionSheet'
import { useFileDetails } from '../hooks/files'
import { deleteFileRecord, updateFilePinnedObjects } from '../db/files'

type Props = NativeStackScreenProps<FeedStackParamList, 'FileDetail'>

export function FileActionsSheet({ route, navigation }: Props) {
  const toast = useToast()
  const { data: file } = useFileDetails(route.params.id)
  const status = useFileStatus(file ?? undefined)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
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
      await deleteFileRecord(file.id)
      toast.show('Deleted file')
      setIsMenuOpen(false)
      navigation.goBack()
    } catch (e) {
      toast.show('Failed to delete file')
      setIsMenuOpen(false)
    }
  }, [file?.id, navigation, toast])

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
      await updateFilePinnedObjects(file.id, {})
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
      headerRight: () => (
        <View style={{ flexDirection: 'row', gap: 14 }}>
          {isUploaded && (
            <Share2Icon
              color="#0969da"
              size={20}
              onPress={handleCopyShareUrl}
            />
          )}
          <MoreVerticalIcon
            color="#0969da"
            size={20}
            onPress={handleOpenMenu}
          />
        </View>
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
    <ActionSheet visible={isMenuOpen} onRequestClose={closeMenu}>
      <ActionSheetButton
        disabled={status.isDownloading || status.isDownloaded}
        variant="primary"
        icon={<ArrowDownToLineIcon size={18} />}
        onPress={handlePressAndClose(handleDownload)}
      >
        Download file
      </ActionSheetButton>
      <ActionSheetButton
        disabled={status.isUploading}
        variant="primary"
        icon={<CloudUploadIcon size={18} />}
        onPress={handlePressAndClose(handleReupload)}
      >
        Reupload file
      </ActionSheetButton>
      <ActionSheetButton
        disabled={!!status.cachedUri}
        variant="primary"
        icon={<EraserIcon size={18} />}
        onPress={handlePressAndClose(handleRemoveCache)}
      >
        Remove from cache
      </ActionSheetButton>
      <ActionSheetButton
        disabled={status.isUploaded}
        variant="primary"
        icon={<CloudOffIcon size={18} />}
        onPress={handlePressAndClose(handleRemoveFromNetwork)}
      >
        Remove from network
      </ActionSheetButton>
      <ActionSheetButton
        disabled={status.isUploaded}
        variant="danger"
        icon={<Trash2Icon size={18} />}
        onPress={handlePressAndClose(handleDelete)}
      >
        Delete file
      </ActionSheetButton>
    </ActionSheet>
  )
}
