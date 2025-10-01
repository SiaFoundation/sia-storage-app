import { type NativeStackScreenProps } from '@react-navigation/native-stack'
import { type MainStackParamList } from '../stacks/types'
import { useCallback, useLayoutEffect, useState } from 'react'
import {
  MoreVerticalIcon,
  Trash2Icon,
  CloudOffIcon,
  EraserIcon,
  CloudUploadIcon,
  ShareIcon,
  Link2Icon,
} from 'lucide-react-native'
import Clipboard from '@react-native-clipboard/clipboard'
import { useToast } from '../lib/toastContext'
import { Linking, View } from 'react-native'
import { ArrowDownToLineIcon } from 'lucide-react-native'
import { removeFromCache } from '../stores/fileCache'
import { useDownload } from '../managers/downloader'
import { extFromMime } from '../lib/fileTypes'
import { useSdk } from '../stores/auth'
import { getOnePinnedObject, useFileStatus } from '../lib/file'
import { encryptionKeyHexToBuffer } from '../lib/encryptionKey'
import { useReuploadFile } from '../managers/uploader'
import { ActionSheetButton } from './ActionSheetButton'
import { ActionSheet } from './ActionSheet'
import {
  useFileDetails,
  deleteFileRecord,
  updateFilePinnedObjects,
} from '../stores/files'
import Share from 'react-native-share'
import { logger } from '../lib/logger'
type Props = NativeStackScreenProps<MainStackParamList, 'FileDetail'>

export function FileActionsSheet({ route, navigation }: Props) {
  const toast = useToast()
  const { data: file } = useFileDetails(route.params.id)
  const status = useFileStatus(file ?? undefined)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const sdk = useSdk()

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

  const handleShareURL = useCallback(async () => {
    if (!file) return
    if (!sdk) return
    const shareUrl = getShareUrl()
    if (!shareUrl) return
    Clipboard.setString(shareUrl)
    toast.show('URL Copied')
  }, [file, sdk, getShareUrl, toast])

  const handleShareFile = useCallback(async () => {
    if (!file) return
    if (!file.fileType) return
    if (!status.cachedUri) return

    try {
      await Share.open({
        url: status.cachedUri,
        type: file.fileType,
        filename: file.fileName ?? undefined,
        subject: `Sia Mobile - ${file.fileType}`,
      })
    } catch (e) {
      if (typeof e === 'string' && !e.includes('User did not share')) {
        logger.log('File sharing failed:', e)
      }
    }
  }, [file, status.cachedUri])

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
    handleShareURL,
    handleOpenDeepLink,
    handleOpenMenu,
    isUploaded,
  ])

  const handleDownload = useDownload(file)
  return (
    <ActionSheet visible={isMenuOpen} onRequestClose={closeMenu}>
      <ActionSheetButton
        disabled={!status.isUploaded}
        variant="primary"
        icon={<Link2Icon size={18} />}
        onPress={handlePressAndClose(handleShareURL)}
      >
        Copy link
      </ActionSheetButton>
      <ActionSheetButton
        disabled={!status.isUploaded}
        variant="primary"
        icon={<ShareIcon size={18} />}
        onPress={handleShareFile}
      >
        Share file
      </ActionSheetButton>
      {!status.isDownloaded && !status.isDownloading && !status.fileIsGone && (
        <ActionSheetButton
          variant="primary"
          icon={<ArrowDownToLineIcon size={18} />}
          onPress={handlePressAndClose(handleDownload)}
        >
          Download file
        </ActionSheetButton>
      )}
      {!status.isUploaded && !status.isUploading && !status.fileIsGone && (
        <ActionSheetButton
          variant="primary"
          icon={<CloudUploadIcon size={18} />}
          onPress={handlePressAndClose(handleReupload)}
        >
          Upload file
        </ActionSheetButton>
      )}
      {status.cachedUri && status.isUploaded && (
        <ActionSheetButton
          variant="primary"
          icon={<EraserIcon size={18} />}
          onPress={handlePressAndClose(handleRemoveCache)}
        >
          Remove from device
        </ActionSheetButton>
      )}
      {status.isUploaded && (
        <ActionSheetButton
          variant="primary"
          icon={<CloudOffIcon size={18} />}
          onPress={handlePressAndClose(handleRemoveFromNetwork)}
        >
          Remove from network
        </ActionSheetButton>
      )}
      <ActionSheetButton
        variant="danger"
        icon={<Trash2Icon size={18} />}
        onPress={handlePressAndClose(handleDelete)}
      >
        Delete file
      </ActionSheetButton>
    </ActionSheet>
  )
}
