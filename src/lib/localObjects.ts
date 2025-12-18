import { PinnedObjectInterface } from 'react-native-sia'
import { getAppKeyForIndexer } from '../stores/appKey'
import { LocalObject } from '../encoding/localObject'

export async function pinnedObjectToLocalObject(
  fileId: string,
  indexerURL: string,
  pinnedObject: PinnedObjectInterface
): Promise<LocalObject> {
  const appKey = await getAppKeyForIndexer(indexerURL)
  if (!appKey) {
    throw new Error(`No AppKey found for indexer: ${indexerURL}`)
  }
  const sealedObject = pinnedObject.seal(appKey)
  return {
    ...sealedObject,
    fileId,
    indexerURL,
    createdAt: sealedObject.createdAt ?? new Date(),
    updatedAt: sealedObject.updatedAt ?? new Date(),
  }
}
