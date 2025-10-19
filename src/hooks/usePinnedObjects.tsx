import { PinnedObject, PinnedObjectInterface } from 'react-native-sia'
import { getAppKey } from '../lib/appKey'
import useSWR from 'swr'
import { FileRecord } from '../stores/files'

export function usePinnedObjects(file: FileRecord) {
  return useSWR<{ indexerURL: string; pinnedObject: PinnedObjectInterface }[]>(
    ['sealedObjects', file.id],
    async () => {
      const sealedObjects = Object.entries(file.objects)
      return await Promise.all(
        sealedObjects.map(async ([indexerURL, so]) => ({
          indexerURL,
          pinnedObject: PinnedObject.open(await getAppKey(), so),
        }))
      )
    }
  )
}
