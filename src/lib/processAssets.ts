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
import { copyFileToCache, getFileUri } from '../stores/fileCache'
import { File } from 'expo-file-system'

type Asset = {
  id: string | undefined
  sourceUri: string | undefined
  size: number | undefined
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
    | 'noFileUri'
    | 'noFileSize'
    | 'noContentHash'
    | null
}

/**
 * processAssets imports a list of assets from any source.
 * This function will:
 * - Check for duplicates by localId and hash.
 * - Copy files without a local ID to the app's file cache.
 * - Add content hashes to files that are new.
 * - Create new file records for the assets.
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
  const candidateFiles: CandidateFileRecord[] = (assets ?? []).map((a) => ({
    id: uniqueId(),
    localId: a.id ?? null,
    // If the asset does not have an id, pass a sourceUri so we can copy the
    // file to the app's file cache.
    sourceUri: a.id ? null : a.sourceUri ?? null,
    name: a.name ?? defaultFileName,
    size: a.size ?? null,
    createdAt: new Date(a.timestamp ?? Date.now()).getTime(),
    updatedAt: new Date(a.timestamp ?? Date.now()).getTime(),
    type: getMimeType({
      type: a.type,
      name: a.name,
      uri: a.sourceUri,
    }),
    hash: null,
    status: 'new',
    statusDetails: null,
  }))

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

  // Non media library assets do not have a localId so we need to copy the
  // file to the app cache.
  const nonMediaAssets = candidateFiles.filter(
    (f) => f.status === 'new' && !f.localId && !!f.sourceUri
  )
  logger.log(
    `[processAssets] copying ${nonMediaAssets.length} non media assets to cache`
  )
  for (const f of nonMediaAssets) {
    await copyFileToCache(f, new File(f.sourceUri!))
  }

  // Add content hash and file size to files that are still new.
  await Promise.all(
    candidateFiles
      .filter((f) => f.status === 'new')
      .map(async (f) => {
        const fileUri = await getFileUri(f)
        if (!fileUri) {
          f.status = 'incomplete'
          f.statusDetails = 'noFileUri'
          return
        }
        if (!f.size) {
          // Try again to get the file size.
          f.size = getFileSize(fileUri)
          if (!f.size) {
            f.status = 'incomplete'
            f.statusDetails = 'noFileSize'
            return
          }
        }
        f.hash = await calculateContentHash(fileUri)
        if (!f.hash) {
          f.status = 'incomplete'
          f.statusDetails = 'noContentHash'
          return
        }
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

  // Assert that the files are new and have a content hash.
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
  logger.log(
    `[processAssets] result: picked=${candidateFiles.length}, new=${newFiles.length}, incomplete=${incompleteFiles.length}, existing=${existingFiles.length}`
  )
  if (existingFilesByLocalIdCount > 0 || existingFilesByContentHashCount > 0) {
    warnings.push('Some files were duplicates and were not included.')
  }

  await updateManyFileRecords(existingFiles)
  await createManyFileRecords(newFiles)

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
