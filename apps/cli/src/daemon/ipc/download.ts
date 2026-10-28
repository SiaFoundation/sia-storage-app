import * as fs from 'fs/promises'
import * as path from 'path'
import type { CliApp } from '../../app'
import type { IpcHandlerMap } from './index'

/**
 * `download`: stream a file from Sia into the daemon's content-addressed
 * store, then copy it to the caller's destination path. The CLI resolves the
 * destination to an absolute path before sending — the daemon's cwd is not
 * the user's shell cwd.
 */
export function registerDownloadHandlers(handlers: IpcHandlerMap, app: CliApp): void {
  handlers.set('download', async (params) => {
    const fileId = params?.fileId as string | undefined
    const output = params?.output as string | undefined
    if (!fileId) throw new Error('Missing fileId parameter')
    if (!output) throw new Error('Missing output parameter')
    if (!path.isAbsolute(output)) throw new Error('output must be an absolute path')

    const file = await app.service.files.getById(fileId)
    if (!file) throw new Error('File not found')

    // The user asked for this file, so it is not queued behind, or dropped
    // for, background downloads.
    await app.service.downloads.downloadFile(fileId, 'user')

    // Through the service, which records the read against the cache's
    // eviction clock. A copy served from the cache keeps its old use time
    // otherwise, and the next pass removes a file the user just asked for.
    const sourceUri = await app.service.fs.getFileUri({ id: fileId, type: file.type })
    if (!sourceUri) throw new Error('The downloaded copy is missing')
    await fs.mkdir(path.dirname(output), { recursive: true })
    await fs.copyFile(sourceUri, output)
    return { name: file.name, path: output }
  })
}
