import { extFromMime } from '@siastorage/core/lib/fileTypes'
import type { FsIOAdapter } from '@siastorage/core/services/fsFileUri'
import { Buffer } from 'buffer'
import RNFS from 'react-native-fs'
import { getStorageDirectoryUri } from '../lib/sharedContainer'

const fsStorageDirectoryUri = `${getStorageDirectoryUri()}/files`

function fsFileUri(fileId: string, type: string): string {
  return `${fsStorageDirectoryUri}/${fileId}${extFromMime(type)}`
}

export function createFsIOAdapter(): FsIOAdapter {
  return {
    uri(fileId, type) {
      return fsFileUri(fileId, type)
    },
    async size(fileId, type) {
      try {
        const stat = await RNFS.stat(fsFileUri(fileId, type))
        return { value: stat.size }
      } catch (e: any) {
        const msg = e?.message ?? ''
        if (msg.includes('does not exist') || msg.includes('ENOENT')) {
          return { value: null, error: 'not_found' as const }
        }
        return { value: null, error: 'stat_error' as const }
      }
    },
    async remove(fileId, type) {
      const uri = fsFileUri(fileId, type)
      if (await RNFS.exists(uri)) {
        await RNFS.unlink(uri)
      }
    },
    async copy(file, sourceUri) {
      const targetUri = fsFileUri(file.id, file.type)
      if (await RNFS.exists(targetUri)) {
        await RNFS.unlink(targetUri)
      }
      await RNFS.copyFile(sourceUri.replace(/^file:\/\//, ''), targetUri)
      const stat = await RNFS.stat(targetUri)
      return { uri: targetUri, size: stat.size }
    },
    async writeFile(file, data) {
      const targetUri = fsFileUri(file.id, file.type)
      if (!(await RNFS.exists(fsStorageDirectoryUri))) {
        await RNFS.mkdir(fsStorageDirectoryUri)
      }
      await RNFS.writeFile(targetUri, Buffer.from(data).toString('base64'), 'base64')
      const stat = await RNFS.stat(targetUri)
      return { uri: targetUri, size: stat.size }
    },
    async list() {
      if (!(await RNFS.exists(fsStorageDirectoryUri))) return []
      const entries = await RNFS.readDir(fsStorageDirectoryUri)
      return entries.filter((e) => e.isFile()).map((e) => e.path)
    },
    async ensureDirectory() {
      if (!(await RNFS.exists(fsStorageDirectoryUri))) {
        await RNFS.mkdir(fsStorageDirectoryUri)
      }
    },
  }
}
