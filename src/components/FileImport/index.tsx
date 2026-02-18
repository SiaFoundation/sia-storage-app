import type { NavigationProp } from '@react-navigation/native'
import { File } from 'expo-file-system'
import { PlusIcon } from 'lucide-react-native'
import { useCallback, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import type { PinnedObjectInterface } from 'react-native-sia'
import useSWR from 'swr'
import { SHARED_FILE_AUTO_DOWNLOAD_THRESHOLD } from '../../config'
import { calculateContentHash } from '../../lib/contentHash'
import {
  detectMimeTypeFromBytes,
  MAGIC_BYTES_LENGTH,
} from '../../lib/detectMimeType'
import { useFileStatus } from '../../lib/file'
import { getMimeType } from '../../lib/fileTypes'
import { pinnedObjectToLocalObject } from '../../lib/localObjects'
import { logger } from '../../lib/logger'
import { useToast } from '../../lib/toastContext'
import {
  downloadFirstBytesFromShared,
  useDownloadFromShareURL,
} from '../../managers/downloader'
import type { RootTabParamList } from '../../stacks/types'
import { useDownloadState } from '../../stores/downloads'
import {
  createFileRecordWithLocalObject,
  type FileRecord,
  readFileRecordByContentHash,
} from '../../stores/files'
import { copyFileToFs, getFsFileUri } from '../../stores/fs'
import { useSdk } from '../../stores/sdk'
import { getIndexerURL } from '../../stores/settings'
import { colors } from '../../styles/colors'
import { BottomActionButton } from '../BottomActionButton'
import { FileViewer } from '../FileViewer'
import { DownloadPrompt } from './DownloadPrompt'
import { FileMetaImport } from './FileMetaImport'

// Helper function to detect file type from first few bytes.
async function detectFileType(
  sdk: ReturnType<typeof useSdk>,
  sharedObject: PinnedObjectInterface,
  id: string,
): Promise<string> {
  logger.debug('FileImport', 'detecting_type', {
    id,
    byteCount: MAGIC_BYTES_LENGTH,
  })
  try {
    if (!sdk || !sharedObject) {
      throw new Error('Missing required data for type detection')
    }

    const bytes = await downloadFirstBytesFromShared(
      sdk,
      sharedObject,
      MAGIC_BYTES_LENGTH,
    )

    if (bytes.length === 0) {
      logger.warn('FileImport', 'no_bytes_for_detection')
      return 'application/octet-stream'
    }

    const type = detectMimeTypeFromBytes(bytes)
    logger.debug('FileImport', 'detected_type', { type })
    return type || 'application/octet-stream'
  } catch (e) {
    logger.error('FileImport', 'type_detection_error', { error: e as Error })
    return 'application/octet-stream'
  }
}

// Helper function to download and process the full file.
async function downloadAndProcessFile(
  id: string,
  shareUrl: string,
  downloadFromShareURL: ReturnType<typeof useDownloadFromShareURL>,
): Promise<FileRecord> {
  logger.debug('FileImport', 'swr_start', { id })
  try {
    if (!shareUrl) throw new Error('Invalid share URL')

    logger.debug('FileImport', 'downloading', { id, shareUrl })
    await downloadFromShareURL(id, shareUrl)
    logger.debug('FileImport', 'download_complete')

    const tempFsFileUri = await getFsFileUri({
      id,
      type: 'application/octet-stream',
    })
    if (!tempFsFileUri) {
      throw new Error('File not found in cache after download')
    }

    logger.debug('FileImport', 'sniffing_type', { uri: tempFsFileUri })
    let type: string
    try {
      type = await getMimeType({ uri: tempFsFileUri })
      logger.debug('FileImport', 'detected_type', { type })
    } catch (e) {
      logger.error('FileImport', 'type_detection_error', { error: e as Error })
      type = 'application/octet-stream'
    }

    const tempFile = new File(tempFsFileUri)
    const fileInfo = tempFile.info()
    const size = fileInfo.size ?? 0

    const finalFsFileUri = await copyFileToFs({ id, type }, tempFile)
    logger.debug('FileImport', 'copied_to_final', { uri: finalFsFileUri })

    if (finalFsFileUri !== tempFsFileUri) {
      tempFile.delete()
    }

    logger.debug('FileImport', 'calculating_hash', { uri: finalFsFileUri })
    const hash = await calculateContentHash(finalFsFileUri)
    logger.debug('FileImport', 'hash_calculated', { hash })

    logger.info('FileImport', 'file_ready', { type, size, hash })

    return {
      id,
      localId: null,
      addedAt: Date.now(),
      name: 'Shared File',
      type,
      kind: 'file',
      size,
      hash: hash ?? '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      objects: {},
    } satisfies FileRecord
  } catch (e) {
    logger.error('FileImport', 'prepare_error', { error: e as Error })
    throw e
  }
}

export function FileImport({
  id,
  shareUrl,
  navigation,
}: {
  id: string
  shareUrl: string
  navigation: NavigationProp<RootTabParamList>
}) {
  const toast = useToast()
  const sdk = useSdk()
  const downloadFromShareURL = useDownloadFromShareURL()
  const [hasConfirmedLargeDownload, setHasConfirmedLargeDownload] =
    useState(false)

  const sharedObject = useSWR(
    sdk ? ['sharedObject', shareUrl, id] : null,
    async () => {
      try {
        if (!sdk || !shareUrl) return null
        return sdk.sharedObject(shareUrl)
      } catch (e) {
        logger.error('FileImport', 'shared_object_error', { error: e as Error })
        return null
      }
    },
  )

  // Check if file requires confirmation - auto-download if less than 5MB.
  const fileSize = sharedObject.data ? Number(sharedObject.data.size()) : null
  const shouldAutoDownload =
    fileSize !== null && fileSize <= SHARED_FILE_AUTO_DOWNLOAD_THRESHOLD
  const requiresConfirmation = !hasConfirmedLargeDownload && !shouldAutoDownload

  // Automatically detect type by downloading only first few bytes.
  const detectedType = useSWR(
    sharedObject.data && shareUrl && sdk
      ? ['detectedType', id, shareUrl]
      : null,
    async () => {
      if (!sdk || !sharedObject.data) {
        throw new Error('Missing SDK or shared object')
      }
      return detectFileType(sdk, sharedObject.data, id)
    },
  )

  // Download and build file metadata. Auto-download if file is small, otherwise require confirmation.
  const sharedFile = useSWR(
    sharedObject.data &&
      shareUrl &&
      (hasConfirmedLargeDownload || shouldAutoDownload)
      ? [
          'sharedFile',
          id,
          shareUrl,
          hasConfirmedLargeDownload,
          shouldAutoDownload,
        ]
      : null,
    () => downloadAndProcessFile(id, shareUrl, downloadFromShareURL),
  )

  // Create a preview FileRecord for the confirmation screen.
  const previewFile = useMemo(() => {
    if (!sharedObject.data) return null
    // Use detected type if available, otherwise fall back to octet-stream.
    const type = detectedType.data || 'application/octet-stream'
    return {
      id,
      localId: null,
      addedAt: Date.now(),
      name: 'Shared File',
      type,
      kind: 'file',
      size: fileSize ?? 0,
      hash: '', // Placeholder until calculated.
      createdAt: Date.now(),
      updatedAt: Date.now(),
      objects: {},
    } satisfies FileRecord
  }, [sharedObject.data, id, fileSize, detectedType.data])

  // Check if metadata is complete (required fields: hash, type, size).
  const isMetadataComplete =
    sharedFile.data?.hash &&
    sharedFile.data.type !== 'application/octet-stream' &&
    sharedFile.data.size > 0

  const displayFile = sharedFile.data || previewFile
  const downloadState = useDownloadState(id)
  const isDownloading =
    downloadState?.status === 'running' || downloadState?.status === 'queued'

  const hasMissingMetadata =
    !displayFile ||
    displayFile.size === 0 ||
    displayFile.type === 'application/octet-stream' ||
    !displayFile.hash

  const fileStatus = useFileStatus(displayFile || undefined, true)

  const [isAddingToDatabase, setIsAddingToDatabase] = useState(false)
  const handleAddToDatabase = useCallback(async () => {
    if (!sharedObject.data || !sdk || !sharedFile.data) {
      toast.show('File not ready')
      return
    }

    // Check for duplicates before setting loading state.
    if (sharedFile.data.hash) {
      const existingFile = await readFileRecordByContentHash(
        sharedFile.data.hash,
      )
      if (existingFile) {
        toast.show('File already exists in library')
        return
      }
    }

    setIsAddingToDatabase(true)
    try {
      logger.info('FileImport', 'importing_file', { id: sharedFile.data.id })

      // Pin the shared object and create file record.
      const indexerURL = await getIndexerURL()
      // sharedObject.data is already a PinnedObjectInterface from sdk.sharedObject()
      await sdk.pinObject(sharedObject.data)
      const localObject = await pinnedObjectToLocalObject(
        sharedFile.data.id,
        indexerURL,
        sharedObject.data,
      )
      await createFileRecordWithLocalObject(sharedFile.data, localObject)

      toast.show('File added')
      navigation.navigate('MainTab', {
        screen: 'LibraryHome',
        params: { openFileId: sharedFile.data.id },
      })
    } catch (e) {
      logger.error('FileImport', 'add_to_library_error', { error: e as Error })
      toast.show('Error adding file to library')
    } finally {
      setIsAddingToDatabase(false)
    }
  }, [sharedObject.data, sdk, sharedFile.data, toast, navigation])

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {sharedObject.isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.accentPrimary} />
            <Text style={styles.loadingText}>Loading…</Text>
          </View>
        ) : sharedObject.error ? (
          <Text style={styles.errorText}>{sharedObject.error.message}</Text>
        ) : displayFile ? (
          <>
            <View style={{ height: 500 }}>
              {sharedFile.data && shareUrl ? (
                <FileViewer
                  file={sharedFile.data}
                  isShared
                  customDownloader={() => {
                    if (sharedFile.data) {
                      downloadFromShareURL(sharedFile.data.id, shareUrl)
                    }
                  }}
                />
              ) : (
                <DownloadPrompt
                  fileId={id}
                  hasMissingMetadata={hasMissingMetadata}
                  onDownloadPress={() => {
                    if (requiresConfirmation) {
                      setHasConfirmedLargeDownload(true)
                    }
                  }}
                  isDownloading={isDownloading}
                />
              )}
            </View>
            {displayFile && fileStatus.data && (
              <FileMetaImport file={displayFile} status={fileStatus.data} />
            )}
          </>
        ) : null}
        {sharedFile.error && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{sharedFile.error.message}</Text>
          </View>
        )}
      </ScrollView>
      <BottomActionButton
        label={isAddingToDatabase ? 'Adding to library...' : 'Add to library'}
        disabled={
          isAddingToDatabase || !isMetadataComplete || requiresConfirmation
        }
        icon={<PlusIcon color="white" size={22} />}
        onPress={handleAddToDatabase}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgCanvas,
  },
  content: { padding: 0, paddingBottom: 100 },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
  },
  loadingText: { color: colors.textSecondary, marginTop: 8 },
  errorText: { color: colors.textDanger },
  errorContainer: {
    padding: 16,
    backgroundColor: colors.bgCanvas,
  },
})
