import type { PinnedObjectRef } from '@siastorage/core/adapters'
import { logger } from '@siastorage/logger'
import useSWR from 'swr'
import { app, internal } from '../stores/appService'

export function usePinnedObjects(fileId: string) {
  return useSWR<{ indexerURL: string; pinnedObject: PinnedObjectRef }[]>(
    ['pinnedObjects', fileId],
    async () => {
      const sdk = internal().getSdk()
      if (!sdk) return []
      const objects = await app().localObjects.getForFile(fileId)
      const results = await Promise.all(
        objects.map(async (so) => {
          const keyBytes = await app().auth.getAppKey(so.indexerURL)
          if (!keyBytes) {
            logger.warn('usePinnedObjects', 'no_app_key', {
              fileId,
              indexerURL: so.indexerURL,
            })
            return null
          }
          return {
            indexerURL: so.indexerURL,
            pinnedObject: sdk.openPinnedObject(sdk.openAppKey(keyBytes), so),
          }
        }),
      )
      return results.filter((o) => o !== null)
    },
  )
}
