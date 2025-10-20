import { PinnedObject, PinnedObjectInterface } from 'react-native-sia'
import { getAppKey } from '../lib/appKey'
import useSWR from 'swr'
import { FileRecord } from '../stores/files'

export function usePinnedObjects(file: FileRecord) {
  return useSWR<{ indexerURL: string; pinnedObject: PinnedObjectInterface }[]>(
    ['pinnedObjects', file.id],
    async () => {
      const objects = Object.entries(file.objects)
      return await Promise.all(
        objects.map(async ([indexerURL, so]) => ({
          indexerURL,
          pinnedObject: PinnedObject.open(await getAppKey(), so),
        }))
      )
    }
  )
}
