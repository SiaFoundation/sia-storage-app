import type { UploadStats } from '@siastorage/core/db/operations'
import { app } from './appService'

export type { UploadStats }

export async function getUploadStats(): Promise<UploadStats> {
  const indexerURL = await app().settings.getIndexerURL()
  return app().stats.uploadStats(indexerURL)
}
