import { uniqueId } from '@siastorage/core/lib/uniqueId'
import { logger } from '@siastorage/logger'
import RNFS from 'react-native-fs'

/**
 * Staging dir for app-born import bytes (camera temps, share-extension
 * container copies): a same-volume rename out of purgeable temp space into
 * an app-owned dir the import scanner can drain across restarts. User-owned
 * sources are never moved here, only referenced.
 */
const IMPORT_STAGING_DIR = `${RNFS.DocumentDirectoryPath}/import-staging`

function decodePath(uri: string): string {
  if (!uri.startsWith('file://')) return uri
  return decodeURIComponent(uri.slice('file://'.length))
}

function extensionOf(path: string): string {
  const name = path.split('/').pop() ?? ''
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot) : ''
}

/**
 * Move a file into the staging dir; returns the staged file:// uri, or null
 * on any failure (the caller degrades to `ephemeral` and the pick still
 * imports this session). RNFS.moveFile is a rename on the same volume and
 * falls back to copy+delete across volumes.
 */
export async function stageFileForImport(sourceUri: string): Promise<string | null> {
  try {
    await RNFS.mkdir(IMPORT_STAGING_DIR)
    const sourcePath = decodePath(sourceUri)
    const stagedPath = `${IMPORT_STAGING_DIR}/${uniqueId()}${extensionOf(sourcePath)}`
    await RNFS.moveFile(sourcePath, stagedPath)
    return `file://${stagedPath}`
  } catch (e) {
    logger.warn('importStaging', 'stage_failed', { error: e as Error })
    return null
  }
}

function isStagedPath(pathOrUri: string): boolean {
  return decodePath(pathOrUri).startsWith(`${IMPORT_STAGING_DIR}/`)
}

/** Delete a staged file; refuses anything outside the staging dir so a bad
 * row can never delete a user file. */
export async function removeStagedFile(pathOrUri: string): Promise<void> {
  const path = decodePath(pathOrUri)
  if (!isStagedPath(path)) return
  try {
    if (await RNFS.exists(path)) await RNFS.unlink(path)
  } catch (e) {
    logger.warn('importStaging', 'remove_failed', { error: e as Error })
  }
}
