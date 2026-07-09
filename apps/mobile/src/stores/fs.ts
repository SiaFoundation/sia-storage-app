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
  logger.debug('fs', 'copy_file', { fileId: file.id, sourceUri })
  const { uri } = await app().fs.copyFile(file, sourceUri)
  await app().caches.fsFileUri.set(uri, file.id)
  return uri
}

export function useFsFileUri(file?: FsFileInfo) {
  return useSWR(file ? app().caches.fsFileUri.key(file.id) : null, () => {
    return file ? app().fs.getFileUri(file) : null
  })
}
