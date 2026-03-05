import type { AppKeyRef, PinnedObjectRef } from '../adapters/sdk'
import type { LocalObject } from '../encoding/localObject'

export function sealPinnedObject(
  fileId: string,
  indexerURL: string,
  pinnedObject: PinnedObjectRef,
  appKey: AppKeyRef,
): LocalObject {
  const sealed = pinnedObject.seal(appKey)
  return {
    ...sealed,
    fileId,
    indexerURL,
    createdAt: sealed.createdAt ?? new Date(),
    updatedAt: sealed.updatedAt ?? new Date(),
  }
}
