import useSWR, { type SWRConfiguration } from 'swr'
import { app } from './appService'

export async function deleteLostFilesAndThumbnails(): Promise<number> {
  const currentIndexerURL = await app().settings.getIndexerURL()
  return app().files.deleteLost(currentIndexerURL)
}

type FileRecordCursorColumn = 'createdAt' | 'updatedAt'

export async function getFilesLocalOnly(params: {
  limit?: number
  order: 'ASC' | 'DESC'
  orderBy?: FileRecordCursorColumn
  excludeIds?: string[]
}) {
  const currentIndexerURL = await app().settings.getIndexerURL()
  return app().files.query({
    limit: params.limit,
    after: undefined,
    order: params.order,
    orderBy: params.orderBy,
    excludeIds: params.excludeIds,
    pinned: {
      indexerURL: currentIndexerURL,
      isPinned: false,
    },
    fileExistsLocally: true,
    includeThumbnails: true,
    includeOldVersions: true,
  })
}

export function useFilesLocalOnly(params: {
  limit?: number
  order: 'ASC' | 'DESC'
  orderBy?: FileRecordCursorColumn
  excludeIds?: string[]
}) {
  const key = app().caches.library.key('localOnly')
  return useSWR([...key, params], () => getFilesLocalOnly(params))
}

async function getFileCountLost() {
  const currentIndexerURL = await app().settings.getIndexerURL()
  return app().files.getLostCount(currentIndexerURL)
}

export function useFileCountLost(config?: SWRConfiguration) {
  const key = app().caches.library.key('lostCount')
  return useSWR(key, getFileCountLost, config)
}

async function getFileStatsLost() {
  const currentIndexerURL = await app().settings.getIndexerURL()
  return app().files.getLostStats(currentIndexerURL)
}

export function useFileStatsLost(config?: SWRConfiguration) {
  const key = app().caches.library.key('lostStats')
  return useSWR(key, getFileStatsLost, config)
}

export async function getFileCountLocal(params: { localOnly: boolean }) {
  const currentIndexerURL = await app().settings.getIndexerURL()
  return app().files.queryCount({
    order: 'ASC',
    pinned: {
      indexerURL: currentIndexerURL,
      isPinned: !params.localOnly,
    },
    fileExistsLocally: true,
    includeThumbnails: true,
    includeOldVersions: true,
  })
}

export function useFileCountLocal(params: { localOnly: boolean }, config?: SWRConfiguration) {
  const key = app().caches.library.key('localCount')
  return useSWR([...key, params], () => getFileCountLocal(params), config)
}

export async function getFileStatsLocal(params: { localOnly: boolean }) {
  const currentIndexerURL = await app().settings.getIndexerURL()
  return app().files.queryStats({
    order: 'ASC',
    pinned: {
      indexerURL: currentIndexerURL,
      isPinned: !params.localOnly,
    },
    fileExistsLocally: true,
    includeThumbnails: true,
    includeOldVersions: true,
  })
}

export function useFileStatsLocal(params: { localOnly: boolean }, config?: SWRConfiguration) {
  const key = app().caches.library.key('localStats')
  return useSWR([...key, params], () => getFileStatsLocal(params), config)
}
