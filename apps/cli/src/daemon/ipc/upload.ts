import type { CliApp } from '../../app'
import { ingestFile } from '../../lib/ingestFile'
import type { IpcHandlerMap } from './index'

const ACTIVE_UPLOAD_STATUSES = ['queued', 'packing', 'packed', 'uploading'] as const

/**
 * `upload`: ingest a single file path on disk into the library.
 * `uploadState`: aggregated upload progress for `sia status` display.
 */
export function registerUploadHandlers(handlers: IpcHandlerMap, app: CliApp): void {
  handlers.set('upload', async (params) => {
    const filePath = params?.path as string | undefined
    if (!filePath) throw new Error('Missing path parameter')
    return ingestFile(app, {
      filePath,
      directory: params?.directory as string | undefined,
    })
  })

  handlers.set('uploadState', async () => {
    const { uploads } = app.service.uploads.getState()
    const entries = Object.values(uploads)
    const active = entries.filter((e) =>
      (ACTIVE_UPLOAD_STATUSES as readonly string[]).includes(e.status),
    )
    const fileIds = active.map((e) => e.id)
    const fileRows = fileIds.length > 0 ? await app.service.files.getRowsByIds(fileIds) : new Map()

    return {
      active: active.map((e) => ({
        id: e.id,
        name: fileRows.get(e.id)?.name ?? e.id,
        size: e.size,
        status: e.status,
        progress: e.progress ?? 0,
      })),
      batch: app.service.uploader.currentBatch(),
      errored: entries.filter((e) => e.status === 'error').length,
    }
  })
}
