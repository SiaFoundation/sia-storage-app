import type { LocalObject } from '@siastorage/core/encoding/localObject'
import { sealPinnedObject } from '@siastorage/core/lib/localObjects'
import type { PinnedObjectInterface } from 'react-native-sia'
import { getAppKeyForIndexer } from '../stores/appKey'

export async function pinnedObjectToLocalObject(
  fileId: string,
  indexerURL: string,
  pinnedObject: PinnedObjectInterface,
): Promise<LocalObject> {
  const appKey = await getAppKeyForIndexer(indexerURL)
  if (!appKey) {
    throw new Error(`No AppKey found for indexer: ${indexerURL}`)
  }
  return sealPinnedObject(fileId, indexerURL, pinnedObject, appKey)
}
