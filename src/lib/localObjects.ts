import { PinnedObjectInterface } from 'react-native-sia'
import { getAppKey } from './appKey'
import { LocalObject } from '../encoding/localObject'

export async function pinnedObjectToLocalObject(
  fileId: string,
  indexerURL: string,
  pinnedObject: PinnedObjectInterface
): Promise<LocalObject> {
  const sealedObject = pinnedObject.seal(await getAppKey())
  return {
    ...sealedObject,
    fileId,
    indexerURL,
    createdAt: sealedObject.createdAt ?? new Date(),
    updatedAt: sealedObject.updatedAt ?? new Date(),
  }
}
