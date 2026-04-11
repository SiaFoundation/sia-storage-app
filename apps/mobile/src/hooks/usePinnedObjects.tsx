import { logger } from '@siastorage/logger'
import { PinnedObject, type PinnedObjectInterface } from 'react-native-sia'
import useSWR from 'swr'
import { getAppKeyForIndexer } from '../stores/appKey'
import { app } from '../stores/appService'

export function usePinnedObjects(fileId: string) {
  return useSWR<{ indexerURL: string; pinnedObject: PinnedObjectInterface }[]>(
    ['pinnedObjects', fileId],
    async () => {
      const objects = await app().localObjects.getForFileWithSlabs(fileId)
      const results = await Promise.all(
        objects.map(async (so) => {
          const appKey = await getAppKeyForIndexer(so.indexerURL)
          if (!appKey) {
            logger.warn('usePinnedObjects', 'no_app_key', {
              fileId,
              indexerURL: so.indexerURL,
            })
            return null
          }
          return {
            indexerURL: so.indexerURL,
            pinnedObject: PinnedObject.open(appKey, so),
          }
        }),
      )
      return results.filter((o) => o !== null)
    },
  )
}
