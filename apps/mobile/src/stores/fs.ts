import { logger } from '@siastorage/logger'
import useSWR from 'swr'
import { app } from './appService'

export type FsFileInfo = {
  id: string
  type: string
}

export async function removeFsFile(file: FsFileInfo): Promise<void> {
  await app().fs.removeFile(file)
  await app().caches.fsFileUri.set(null, file.id)
}

/**
 * Copy a file into app storage.
 *
 * Suspension signal policy: does NOT accept a signal. Wraps a single
 * native RNFS.copyFile call that can't be cancelled mid-flight in JS.
 * Callers that loop over many copies should check their signal at the
 * loop boundary before invoking.
 */
export async function copyFileToFs(file: FsFileInfo, sourceUri: string): Promise<string> {
  logger.debug('fs', 'copy_file', { fileId: file.id })
  const { uri } = await app().fs.copyFile(file, sourceUri)
  await app().caches.fsFileUri.set(uri, file.id)
  return uri
}

/**
 * Rename a finished download's temp into its storage slot, consuming the temp.
 * A download stages to a temp first because execute() treats any bytes already
 * at the slot as complete, so a partial write there would look permanently
 * done. hash: false because the download already knows its size.
 */
export async function adoptFileToFs(file: FsFileInfo, sourceUri: string): Promise<string> {
  logger.debug('fs', 'adopt_file', { fileId: file.id })
  const { uri } = await app().fs.adoptFile(file, sourceUri, { hash: false })
  await app().caches.fsFileUri.set(uri, file.id)
  return uri
}

/**
 * A file's local copy, looked up without counting as a use of it. Library
 * tiles, thumbnails and file details read this as they render, and counting
 * those reads would keep every copy scrolled past safe from eviction. Every
 * caller of a file shares one cached lookup, so the screens where the user
 * opens, shares or saves a file record the use with [recordFileUse].
 */
export function lookupFsFileUri(file: FsFileInfo): Promise<string | null> {
  return app().fs.getFileUri(file)
}

export function useFsFileUri(file?: FsFileInfo) {
  return useSWR(file ? app().caches.fsFileUri.key(file.id) : null, () => {
    return file ? lookupFsFileUri(file) : null
  })
}

/**
 * Counts a read the user asked for, such as opening or sharing, as a use of the
 * file's local copy. Share and save call it before they read the bytes, so a
 * failure is logged and swallowed rather than failing the share.
 */
export async function recordFileUse(file: FsFileInfo): Promise<void> {
  try {
    await app().fs.getFileUri(file, { recordUse: true })
  } catch (error) {
    logger.warn('fs', 'record_use_failed', { fileId: file.id, error: error as Error })
  }
}
