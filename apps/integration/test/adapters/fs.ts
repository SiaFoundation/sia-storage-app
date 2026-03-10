import type { DatabaseAdapter } from '@siastorage/core/adapters'
import {
  deleteFsFileMetadata,
  upsertFsFileMetadata,
} from '@siastorage/core/db/operations'
import { extFromMime } from '@siastorage/core/lib/fileTypes'
import {
  getFsFileUri as coreGetFsFileUri,
  type FsFileUriAdapter,
} from '@siastorage/core/services/fsFileUri'
import * as crypto from 'crypto'
import * as nodeFs from 'fs'
import * as path from 'path'

export function buildFsDeps(params: { db: DatabaseAdapter; tempDir: string }) {
  const { db, tempDir } = params

  function fsFilePath(fileId: string, type: string): string {
    const ext = extFromMime(type)
    return path.join(tempDir, `${fileId}${ext}`)
  }

  const fsAdapter: FsFileUriAdapter = {
    exists(fileId, type) {
      return nodeFs.existsSync(fsFilePath(fileId, type))
    },
    uri(fileId, type) {
      return `file://${fsFilePath(fileId, type)}`
    },
    size(fileId, type) {
      try {
        return nodeFs.statSync(fsFilePath(fileId, type)).size
      } catch {
        return null
      }
    },
  }

  async function getFsFileUri(file: {
    id: string
    type: string
  }): Promise<string | null> {
    return coreGetFsFileUri(db, file, fsAdapter)
  }

  async function removeFsFile(fileId: string, type: string): Promise<void> {
    const fp = fsFilePath(fileId, type)
    if (nodeFs.existsSync(fp)) {
      nodeFs.unlinkSync(fp)
    }
    await deleteFsFileMetadata(db, fileId)
  }

  function listFsFiles(): string[] {
    if (!nodeFs.existsSync(tempDir)) return []
    return nodeFs.readdirSync(tempDir) as string[]
  }

  async function copyToFs(
    file: { id: string; type: string },
    data: ArrayBuffer,
  ): Promise<{ uri: string; size: number; hash: string }> {
    const fp = fsFilePath(file.id, file.type)
    const buf = Buffer.from(data)
    nodeFs.writeFileSync(fp, buf)
    const hash = crypto.createHash('sha256').update(buf).digest('hex')
    const now = Date.now()
    await upsertFsFileMetadata(db, {
      fileId: file.id,
      size: data.byteLength,
      addedAt: now,
      usedAt: now,
    })
    return { uri: `file://${fp}`, size: data.byteLength, hash }
  }

  return {
    fsFilePath,
    fsAdapter,
    getFsFileUri,
    removeFsFile,
    listFsFiles,
    copyToFs,
  }
}
