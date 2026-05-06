import { extFromMime } from '@siastorage/core/lib/fileTypes'
import type { FsIOAdapter } from '@siastorage/core/services/fsFileUri'
import { Buffer } from 'buffer'
import RNFS from 'react-native-fs'
import { getStorageDirectoryUri } from '../lib/sharedContainer'

const fsStorageDirectoryUri = `${getStorageDirectoryUri()}/files`

function fsFileUri(fileId: string, type: string): string {
  return `${fsStorageDirectoryUri}/${fileId}${extFromMime(type)}`
}

// iOS pickers (Document Picker, share inbox) hand us percent-encoded
// `file://` URLs — `Screenshot%202025-09-03.png` — but RNFS expects a
// real filesystem path with literal spaces. Fall back to the raw path
// if decoding throws on a malformed URI (literal `%` + non-hex).
function fileUriToPath(uri: string): string {
  if (!uri.startsWith('file://')) return uri
  const path = uri.slice('file://'.length)
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
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
      } catch {
        const exists = await RNFS.exists(fsFileUri(fileId, type))
        if (!exists) {
          return { value: null, error: 'not_found' }
        }
        return { value: null, error: 'stat_error' }
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
      await RNFS.copyFile(fileUriToPath(sourceUri), targetUri)
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
    async adoptFile(file, sourceUri) {
      const targetUri = fsFileUri(file.id, file.type)
      if (!(await RNFS.exists(fsStorageDirectoryUri))) {
        await RNFS.mkdir(fsStorageDirectoryUri)
      }
      if (await RNFS.exists(targetUri)) {
        await RNFS.unlink(targetUri)
      }
      await RNFS.moveFile(fileUriToPath(sourceUri), targetUri)
      const stat = await RNFS.stat(targetUri)
      const hash = await RNFS.hash(targetUri, 'sha256')
      return { uri: targetUri, size: stat.size, hash }
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
