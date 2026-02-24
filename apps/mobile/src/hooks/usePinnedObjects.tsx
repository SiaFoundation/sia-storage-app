import { logger } from '@siastorage/logger'
import { PinnedObject, type PinnedObjectInterface } from 'react-native-sia'
import useSWR from 'swr'
import { getAppKeyForIndexer } from '../stores/appKey'
import type { FileRecord } from '../stores/files'

export function usePinnedObjects(file: FileRecord) {
  return useSWR<{ indexerURL: string; pinnedObject: PinnedObjectInterface }[]>(
    ['pinnedObjects', file.id],
    async () => {
      const objects = Object.entries(file.objects)
      const results = await Promise.all(
        objects.map(async ([indexerURL, so]) => {
          const appKey = await getAppKeyForIndexer(indexerURL)
          if (!appKey) {
            // TODO: Figure out how to handle this situation.
            logger.warn('usePinnedObjects', 'no_app_key', {
              fileId: file.id,
              indexerURL,
            })
            return null
          }
          return {
            indexerURL,
            pinnedObject: PinnedObject.open(appKey, so),
          }
        }),
      )
      return results.filter((o) => o !== null)
    },
  )
}
