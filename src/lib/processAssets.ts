import { uniqueId } from './uniqueId'
import { logger } from './logger'
import {
  createManyFileRecords,
  FileRecord,
  readFileRecordsByContentHashes,
  readFileRecordsByLocalIds,
  updateManyFileRecords,
} from '../stores/files'
import { MimeType, getMimeType } from './fileTypes'
import { calculateContentHash } from './contentHash'
import { copyFileToFs } from '../stores/fs'
import { File } from 'expo-file-system'
import { generateThumbnails } from '../managers/thumbnailer'
import { getMediaLibraryUri } from './mediaLibrary'

type Asset = {
  id: string | undefined
  sourceUri: string | undefined
  type: string | undefined
  name: string | undefined
  timestamp: string | undefined
}

type CandidateFileRecord = {
  id: string
  localId: string | null
  name: string
  createdAt: number
  updatedAt: number
  type: MimeType
  hash: string | null
  size: number | null
  sourceUri: string | null
  status: 'existing' | 'new' | 'incomplete'
  statusDetails:
    | 'foundByLocalId'
    | 'foundByContentHash'
    | 'noUri'
    | 'invalidUri'
    | 'noFileSize'
    | 'noContentHash'
    | null
}

/**
 * processAssets imports a list of assets from any source.
 * This function will:
 * - Check for duplicates by localId and hash.
 * - Copy every asset to the app's file cache.
 * - Add content hashes to files that are new.
 * - Create new file records for the assets.
 * - Update the metadata of any existing files.
 * - Generate thumbnails for new image and video files.
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
  const candidateFiles: CandidateFileRecord[] = await Promise.all(
    (assets ?? []).map(async (a) => ({
      id: uniqueId(),
      localId: a.id ?? null,
      sourceUri: a.sourceUri ?? null,
      name: a.name ?? defaultFileName,
      size: null,
      createdAt: new Date(a.timestamp ?? Date.now()).getTime(),
      updatedAt: new Date(a.timestamp ?? Date.now()).getTime(),
      type: await getMimeType({
        type: a.type,
        name: a.name,
        uri: a.sourceUri,
      }),
      hash: null,
      status: 'new',
      statusDetails: null,
    }))
  )

  // Update the status of the files that are found by localId.
  // This is quick but will only detect duplicates from the same device.
  const existingLocalIds = await readFileRecordsByLocalIds(
    candidateFiles.filter((a) => !!a.localId).map((a) => a.localId!)
  )
  for (const f of existingLocalIds) {
    const validFile = candidateFiles.find((v) => v.localId === f.localId)
    if (validFile) {
      validFile.id = f.id
      validFile.status = 'existing'
      validFile.statusDetails = 'foundByLocalId'
    }
  }

  // Copy files to the app's file cache.
  // Add content hash and file size to files that are still new.
  await Promise.all(
    candidateFiles
      .filter((f) => f.status === 'new')
      .map(async (f) => {
        // Verify that the localId is a valid Media Library or MediaStore ID.
        const localUri = await getMediaLibraryUri(f.localId)
        if (!localUri) {
          f.localId = null
        }

        // Verify we have a URI.
        const bestUri = localUri ?? f.sourceUri
        if (!bestUri) {
          f.status = 'incomplete'
          f.statusDetails = 'noUri'
          return
        }

        // Copy the file to the app's file cache.
        const fileUri = await copyFileToFs(f, new File(bestUri))
        if (!fileUri) {
          f.status = 'incomplete'
          f.statusDetails = 'invalidUri'
          return
        }

        const hash = await calculateContentHash(fileUri)
        if (!hash) {
          f.status = 'incomplete'
          f.statusDetails = 'noContentHash'
          return
        }
        f.hash = hash

        const size = getFileSize(fileUri)
        if (!size) {
          f.status = 'incomplete'
          f.statusDetails = 'noFileSize'
          return
        }
        f.size = size
      })
  )

  // Check for duplicates by content hash.
  const existingContentHashes = await readFileRecordsByContentHashes(
    candidateFiles
      .filter((f) => f.status === 'new' && f.hash !== null)
      .map((f) => f.hash!)
  )

  // Update the status of the files that are found by content hash.
  for (const f of existingContentHashes) {
    const validFile = candidateFiles.find((v) => v.hash === f.hash)
    if (validFile) {
      validFile.id = f.id
      validFile.status = 'existing'
      validFile.statusDetails = 'foundByContentHash'
    }
  }

  // Mark any hash-based duplicates within the new files as existing.
  const hashSet = new Set<string>()
  for (const f of candidateFiles.filter(
    (f) => f.status === 'new' && f.hash !== null
  )) {
    const exists = hashSet.has(f.hash!)
    if (exists) {
      f.status = 'existing'
      f.statusDetails = 'foundByContentHash'
    }
    hashSet.add(f.hash!)
  }

  // Assert that the files are new and have a content hash and size.
  const newFiles: FileRecord[] = candidateFiles
    .filter((f) => f.status === 'new' && f.hash !== null && f.size !== null)
    .map((f) => ({
      id: f.id,
      localId: f.localId,
      name: f.name,
      createdAt: f.createdAt,
      updatedAt: f.updatedAt,
      addedAt: Date.now(),
      type: f.type,
      size: f.size!,
      hash: f.hash!,
      objects: {},
    }))
  const incompleteFiles = candidateFiles.filter(
    (f) => f.status === 'incomplete'
  )
  const existingFiles = candidateFiles.filter((f) => f.status === 'existing')

  const warnings: string[] = []
  const existingFilesByLocalIdCount = existingLocalIds.length
  const existingFilesByContentHashCount = existingContentHashes.length
  logger.debug(
    'processAssets',
    `result: picked=${candidateFiles.length}, new=${newFiles.length}, incomplete=${incompleteFiles.length}, existing=${existingFiles.length}`
  )
  if (existingFilesByLocalIdCount > 0 || existingFilesByContentHashCount > 0) {
    warnings.push('Some files were duplicates and were not included.')
  }

  await updateManyFileRecords(existingFiles)
  await createManyFileRecords(newFiles)

  // Generate thumbnails for new image and video files.
  logger.debug(
    'processAssets',
    `generating thumbnails for ${newFiles.length} new files`
  )

  // Generate thumbnails for new files, this will run in the background.
  generateThumbnails(newFiles)

  return {
    files: newFiles,
    updatedFiles: existingFiles,
    warnings,
  }
}

function getFileSize(fileUri: string) {
  const info = new File(fileUri).info()
  return info.size ?? null
}
