import { extFromMime } from '@siastorage/core/lib/fileTypes'
import type { FsIOAdapter } from '@siastorage/core/services/fsFileUri'
import * as nodeFs from 'fs'
import * as path from 'path'

export function createFsAdapter(params: { tempDir: string }) {
  const { tempDir } = params

  function fsFilePath(fileId: string, type: string): string {
    const ext = extFromMime(type)
    return path.join(tempDir, `${fileId}${ext}`)
  }

  const fsIO: FsIOAdapter = {
    uri(fileId, type) {
      return `file://${fsFilePath(fileId, type)}`
    },
    async size(fileId, type) {
      try {
        return { value: nodeFs.statSync(fsFilePath(fileId, type)).size }
      } catch (e: any) {
        if (e?.code === 'ENOENT') {
          return { value: null, error: 'not_found' as const }
        }
        return { value: null, error: 'stat_error' as const }
      }
    },
    async remove(fileId, type) {
      const fp = fsFilePath(fileId, type)
      if (nodeFs.existsSync(fp)) {
        nodeFs.unlinkSync(fp)
      }
    },
    async copy(file, sourceUri) {
      const fp = fsFilePath(file.id, file.type)
      const sourcePath = sourceUri.replace(/^file:\/\//, '')
      nodeFs.copyFileSync(sourcePath, fp)
      const size = nodeFs.statSync(fp).size
      return { uri: `file://${fp}`, size }
    },
    async writeFile(file, data) {
      const fp = fsFilePath(file.id, file.type)
      const buf = Buffer.from(data)
      nodeFs.writeFileSync(fp, buf)
      return { uri: `file://${fp}`, size: buf.byteLength }
    },
    async list() {
      if (!nodeFs.existsSync(tempDir)) return []
      return nodeFs.readdirSync(tempDir) as string[]
    },
    async ensureDirectory() {
      if (!nodeFs.existsSync(tempDir)) {
        nodeFs.mkdirSync(tempDir, { recursive: true })
      }
    },
  }

  return {
    fsFilePath,
    fsIO,
  }
}
