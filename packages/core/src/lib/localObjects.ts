import type { AppKeyRef, PinnedObjectRef } from '../adapters/sdk'
import type { LocalObjectWithSlabs } from '../encoding/localObject'

export function sealPinnedObject(
  fileId: string,
  indexerURL: string,
  pinnedObject: PinnedObjectRef,
  appKey: AppKeyRef,
): LocalObjectWithSlabs {
  const sealed = pinnedObject.seal(appKey)
  return {
    ...sealed,
    fileId,
    indexerURL,
    createdAt: sealed.createdAt ?? new Date(),
    updatedAt: sealed.updatedAt ?? new Date(),
  }
}
