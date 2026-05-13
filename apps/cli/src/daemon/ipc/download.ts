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

    const file = await app.service.files.getById(fileId)
    if (!file) throw new Error('File not found')

    await app.service.downloads.downloadFile(fileId)

    if (!path.isAbsolute(output)) {
      throw new Error('output must be an absolute path')
    }
    const sourceUri = app.fsIO.uri(fileId, file.type)
    await fs.mkdir(path.dirname(output), { recursive: true })
    await fs.copyFile(sourceUri, output)
    return { name: file.name, path: output }
  })
}
