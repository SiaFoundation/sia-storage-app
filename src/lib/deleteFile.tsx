import { LocalObject } from '../encoding/localObject'
import { removeFsFile } from '../stores/fs'
import { removeTempDownloadFile } from '../stores/tempFs'
import { deleteFileRecord, FileRecord } from '../stores/files'
import { deleteLocalObjects } from '../stores/localObjects'
import { getSdk } from '../stores/sdk'
import { cancelUpload } from '../stores/uploads'

export async function permanentlyDeleteFile(file: FileRecord) {
  cancelUpload(file.id)
  await deleteFileRecord(file.id)
  await deleteAllIndexerObjects(file)
  await deleteLocalObjects(file.id)
  await removeFsFile(file)
  await removeTempDownloadFile(file)
}

export async function deleteFileFromNetwork(file: FileRecord) {
  await deleteAllIndexerObjects(file)
  await deleteLocalObjects(file.id)
}

// TODO: in the future if a file is synced with multiple indexers,
// we will need to init and use an sdk for each indexer.
export async function deleteAllIndexerObjects(file: {
  objects?: Record<string, LocalObject>
}) {
  if (!file.objects) return
  const sdk = getSdk()
  if (!sdk) return
  for (const [_, object] of Object.entries(file.objects)) {
    if (object.id) {
      await sdk.deleteObject(object.id)
    }
  }
}
