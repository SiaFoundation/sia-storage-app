import type { FileRecord } from '@siastorage/core/types'
import { app } from '../stores/appService'

export async function permanentlyDeleteFile(file: FileRecord) {
  await permanentlyDeleteFiles([file])
}

export async function permanentlyDeleteFiles(
  files: FileRecord[],
): Promise<void> {
  if (files.length === 0) return
  await app().files.permanentlyDeleteWithCleanup(files)
}

export async function autoPurgeOldTrashedFiles() {
  await app().files.autoPurgeWithCleanup()
}
