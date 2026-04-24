import type { NavigationProp } from '@react-navigation/native'
import { SHARED_FILE_AUTO_DOWNLOAD_THRESHOLD } from '@siastorage/core/config'
import { useDownloadEntry, useSdk } from '@siastorage/core/stores'
import type { FileRecord } from '@siastorage/core/types'
import { logger } from '@siastorage/logger'
import { PlusIcon } from 'lucide-react-native'
import { useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native'
import RNFS from 'react-native-fs'
import useSWR from 'swr'
import { calculateContentHash } from '../../lib/contentHash'
import { detectMimeTypeFromBytes, MAGIC_BYTES_LENGTH } from '../../lib/detectMimeType'
import { useFileStatus } from '../../lib/file'
import { getMimeType } from '../../lib/fileTypes'
import { useToast } from '../../lib/toastContext'
import { useDownloadFromShareURL } from '../../managers/downloader'
import type { RootTabParamList } from '../../stacks/types'
import { app } from '../../stores/appService'
import { copyFileToFs } from '../../stores/fs'
import { colors } from '../../styles/colors'
import { BottomActionButton } from '../BottomActionButton'
import { FileViewer } from '../FileViewer'
import { DownloadPrompt } from './DownloadPrompt'
import { FileMetaImport } from './FileMetaImport'

// Helper function to detect file type from first few bytes.
async function detectFileType(shareUrl: string, id: string): Promise<string> {
  logger.debug('FileImport', 'detecting_type', { id, byteCount: MAGIC_BYTES_LENGTH })
  try {
    const bytes = await app().shares.downloadFirstBytes(shareUrl, MAGIC_BYTES_LENGTH)
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

    const tempFsFileUri = await app().fs.getFileUri({
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

    const fileStat = await RNFS.stat(tempFsFileUri)
    const size = fileStat.size ?? 0

    const finalFsFileUri = await copyFileToFs({ id, type }, tempFsFileUri)
    logger.debug('FileImport', 'copied_to_final', { uri: finalFsFileUri })

    if (finalFsFileUri !== tempFsFileUri) {
      try {
        await RNFS.unlink(tempFsFileUri)
      } catch {
        // Temp file may already be gone.
      }
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
      trashedAt: null,
      deletedAt: null,
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
  const { data: isConnected } = useSdk()
  const downloadFromShareURL = useDownloadFromShareURL()
  const [hasConfirmedLargeDownload, setHasConfirmedLargeDownload] = useState(false)

  const sharedObject = useSWR(isConnected ? ['sharedObject', shareUrl, id] : null, () => {
    if (!shareUrl) throw new Error('Missing share URL')
    return app().shares.getMetadata(shareUrl)
  })

  const fileSize = sharedObject.data ? sharedObject.data.size : null
  const shouldAutoDownload = fileSize !== null && fileSize <= SHARED_FILE_AUTO_DOWNLOAD_THRESHOLD
  const requiresConfirmation = !hasConfirmedLargeDownload && !shouldAutoDownload

  const detectedType = useSWR(
    sharedObject.data && shareUrl && isConnected ? ['detectedType', id, shareUrl] : null,
    () => detectFileType(shareUrl, id),
  )

  // Download and build file metadata. Auto-download if file is small, otherwise require confirmation.
  const sharedFile = useSWR(
    sharedObject.data && shareUrl && (hasConfirmedLargeDownload || shouldAutoDownload)
      ? ['sharedFile', id, shareUrl, hasConfirmedLargeDownload, shouldAutoDownload]
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
      trashedAt: null,
      deletedAt: null,
      objects: {},
    } satisfies FileRecord
  }, [sharedObject.data, id, fileSize, detectedType.data])

  // Check if metadata is complete (required fields: hash, type, size).
  const isMetadataComplete =
    sharedFile.data?.hash &&
    sharedFile.data.type !== 'application/octet-stream' &&
    sharedFile.data.size > 0

  const displayFile = sharedFile.data || previewFile
  const { data: downloadState } = useDownloadEntry(id)
  const isDownloading =
    downloadState?.status === 'downloading' || downloadState?.status === 'queued'

  const hasMissingMetadata =
    !displayFile ||
    displayFile.size === 0 ||
    displayFile.type === 'application/octet-stream' ||
    !displayFile.hash

  const fileStatus = useFileStatus(displayFile || undefined, true)

  const [isAddingToDatabase, setIsAddingToDatabase] = useState(false)
  const handleAddToDatabase = useCallback(async () => {
    if (!sharedObject.data || !isConnected || !sharedFile.data) {
      toast.show('File not ready')
      return
    }

    if (sharedFile.data.hash) {
      const existingFile = await app().files.getByContentHash(sharedFile.data.hash)
      if (existingFile) {
        toast.show('File already exists in library')
        return
      }
    }

    setIsAddingToDatabase(true)
    try {
      logger.info('FileImport', 'importing_file', { id: sharedFile.data.id })

      const localObject = await app().shares.pin(shareUrl, sharedFile.data.id)
      await app().files.create(sharedFile.data, localObject)

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
  }, [sharedObject.data, isConnected, sharedFile.data, shareUrl, toast, navigation])

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {!isConnected ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.accentPrimary} />
            <Text style={styles.loadingText}>Waiting for connection…</Text>
          </View>
        ) : sharedObject.isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.accentPrimary} />
            <Text style={styles.loadingText}>Loading…</Text>
          </View>
        ) : sharedObject.error ? (
          <View style={styles.center}>
            <Text style={styles.errorText}>{sharedObject.error.message}</Text>
          </View>
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
        disabled={isAddingToDatabase || !isMetadataComplete || requiresConfirmation}
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
