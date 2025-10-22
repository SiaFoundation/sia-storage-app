import { uniqueId } from './uniqueId'
import { logger } from './logger'
import {
  createManyFileRecords,
  FileRecord,
  readFileRecordsByContentHashes,
  readFileRecordsByLocalIds,
  updateManyFileRecords,
} from '../stores/files'
import { mimeFromAssetUri } from './fileTypes'
import { calculateContentHash } from './contentHash'
import { copyFileToCache, getLocalUri } from '../stores/fileCache'
import { removeEmptyValues } from './object'
import { File } from 'expo-file-system'

type Asset = {
  id: string | undefined
  sourceUri: string | undefined
  fileSize: number | undefined
  fileType: string | undefined
  fileName: string | undefined
  timestamp: string | undefined
}

type IncomingFileRecord = FileRecord & {
  sourceUri?: string
  status: 'foundByLocalId' | 'foundByContentHash' | 'new'
}

/**
 * processAssets imports a list of assets from any source.
 * This function will:
 * - Check for duplicates by localId and contentHash.
 * - Create new file records for the assets.
 * - Copy files without a local ID to the app's file cache.
 * - Update the metadata of any existing files.
 * - Return the resulting files and warnings.
 * @param assets - The assets to process.
 * @param defaultFileName - The default file name to use for assets that do not have a file name.
 * @returns The resulting files and warnings.
 * @throws If the assets cannot be processed.
 */
export async function processAssets(
  assets: Asset[] | undefined,
  defaultFileName: string = 'file'
) {
  const incomingFiles: IncomingFileRecord[] = (assets ?? []).map((a) => {
    if (a.id) {
      return {
        id: uniqueId(),
        localId: a.id ?? null,
        fileName: a.fileName ?? defaultFileName,
        fileSize: a.fileSize ?? null,
        createdAt: new Date(a.timestamp ?? Date.now()).getTime(),
        updatedAt: new Date(a.timestamp ?? Date.now()).getTime(),
        fileType: a.fileType ?? mimeFromAssetUri(a),
        objects: {},
        contentHash: null,
        status: 'new',
      }
    }
    // If the asset does not have an id, pass a sourceUri so we can copy the
    // file to the app's file cache.
    return {
      id: uniqueId(),
      localId: null,
      sourceUri: a.sourceUri,
      fileName: a.fileName ?? defaultFileName,
      fileSize: a.fileSize ?? null,
      createdAt: new Date(a.timestamp ?? Date.now()).getTime(),
      updatedAt: new Date(a.timestamp ?? Date.now()).getTime(),
      fileType: a.fileType ?? mimeFromAssetUri(a),
      objects: {},
      contentHash: null,
      status: 'new',
    }
  })

  // Update the status of the files that are found by localId.
  // This is quick but will only detect duplicates from the same device.
  const existingLocalIds = await readFileRecordsByLocalIds(
    incomingFiles.filter((a) => a.localId !== null).map((a) => a.localId!)
  )
  for (const f of existingLocalIds) {
    const validFile = incomingFiles.find((v) => v.localId === f.localId)
    if (validFile) {
      validFile.id = f.id
      validFile.status = 'foundByLocalId'
    }
  }

  // Add content hashes to files that are still new.
  await Promise.all(
    incomingFiles
      .filter((f) => f.status === 'new')
      .map(async (f) => {
        const fileUri = await getLocalUri(f.localId)
        if (!fileUri) return f
        const contentHash = await calculateContentHash(fileUri)
        f.contentHash = contentHash
      })
  )

  // Check for duplicates by content hash.
  const existingContentHashes = await readFileRecordsByContentHashes(
    incomingFiles
      .filter((f) => f.status === 'new' && f.contentHash !== null)
      .map((f) => f.contentHash!)
  )

  // Update the status of the files that are found by content hash.
  for (const f of existingContentHashes) {
    const validFile = incomingFiles.find((v) => v.contentHash === f.contentHash)
    if (validFile) {
      validFile.id = f.id
      validFile.status = 'foundByContentHash'
    }
  }

  const newFiles = incomingFiles.filter((f) => f.status === 'new')
  const existingFiles = incomingFiles.filter((f) => f.status !== 'new')

  // Non media library assets do not have a localId so we need to copy the
  // file to the app cache.
  const nonMediaAssets = newFiles.filter((a) => !!a.sourceUri)
  logger.log(
    `[processAssets] copying ${nonMediaAssets.length} non media assets to cache`
  )
  for (const f of nonMediaAssets) {
    await copyFileToCache(f, new File(f.sourceUri!))
  }

  const warnings: string[] = []
  const existingFilesByLocalIdCount = existingLocalIds.length
  const existingFilesByContentHashCount = existingContentHashes.length
  logger.log(
    `[processAssets] result: picked=${incomingFiles.length}, new=${newFiles.length}, existingFilesByLocalId=${existingFilesByLocalIdCount}, existingFilesByContentHash=${existingFilesByContentHashCount}`
  )
  if (existingFilesByLocalIdCount > 0 || existingFilesByContentHashCount > 0) {
    warnings.push('Some files were duplicates and were not included.')
  }

  await updateManyFileRecords(existingFiles.map((f) => removeEmptyValues(f)))
  await createManyFileRecords(newFiles)

  return {
    files: newFiles,
    updatedFiles: existingFiles,
    warnings,
  }
}
