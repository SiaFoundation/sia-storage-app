import { extFromMime } from '@siastorage/core/lib/fileTypes'
import type { FsIOAdapter } from '@siastorage/core/services/fsFileUri'
import * as fs from 'fs/promises'
import * as path from 'path'

export function createNodeFsIO(filesDir: string): FsIOAdapter {
  function filePath(fileId: string, type: string): string {
    const ext = extFromMime(type)
    return path.join(filesDir, `${fileId}${ext}`)
  }

  return {
    uri(fileId, type) {
      return filePath(fileId, type)
    },

    async size(fileId, type) {
      try {
        const stat = await fs.stat(filePath(fileId, type))
        return { value: stat.size }
      } catch (e: any) {
        if (e?.code === 'ENOENT') {
          return { value: null, error: 'not_found' }
        }
        return { value: null, error: 'stat_error' }
      }
    },

    async remove(fileId, type) {
      try {
        await fs.unlink(filePath(fileId, type))
      } catch (e: any) {
        if (e?.code !== 'ENOENT') throw e
      }
    },

    async copy(file, sourceUri) {
      const target = filePath(file.id, file.type)
      const sourcePath = sourceUri.replace(/^file:\/\//, '')
      await fs.copyFile(sourcePath, target)
      const stat = await fs.stat(target)
      return { uri: target, size: stat.size }
    },

    async writeFile(file, data) {
      const target = filePath(file.id, file.type)
      const buf = Buffer.from(data)
      await fs.writeFile(target, buf)
      return { uri: target, size: buf.byteLength }
    },

    async renameToType(file, newType) {
      const oldPath = filePath(file.id, file.type)
      const newPath = filePath(file.id, newType)
      if (oldPath === newPath) return { uri: oldPath }
      try {
        await fs.access(oldPath)
      } catch {
        // oldPath missing — only treat as success if newPath exists
        // (idempotent retry after a partial rename), otherwise the
        // caller will record a DB type for which no file is on disk.
        try {
          await fs.access(newPath)
          return { uri: newPath }
        } catch {
          throw new Error(`renameToType: neither ${oldPath} nor ${newPath} exists`)
        }
      }
      try {
        await fs.unlink(newPath)
      } catch (e: any) {
        if (e?.code !== 'ENOENT') throw e
      }
      await fs.rename(oldPath, newPath)
      return { uri: newPath }
    },

    async list() {
      try {
        return await fs.readdir(filesDir)
      } catch (e: any) {
        if (e?.code === 'ENOENT') return []
        throw e
      }
    },

    async ensureDirectory() {
      await fs.mkdir(filesDir, { recursive: true })
    },
  }
}
