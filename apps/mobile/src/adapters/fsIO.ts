import { IMPORT_STALE_CLAIM_MS } from '@siastorage/core/config'
import { extFromMime } from '@siastorage/core/lib/fileTypes'
import type { FsIOAdapter } from '@siastorage/core/services/fsFileUri'
import { Buffer } from 'buffer'
import { getFreeDiskStorageAsync } from 'expo-file-system/legacy'
import RNFS from 'react-native-fs'
import { copyImportFile } from '../lib/importCopy'
import { getStorageDirectoryUri } from '../lib/sharedContainer'

const fsStorageDirectoryUri = `${getStorageDirectoryUri()}/files`

function fsFileUri(fileId: string, type: string): string {
  return `${fsStorageDirectoryUri}/${fileId}${extFromMime(type)}`
}

// Temp path for an in-flight scanner copy, tagged with the claim token so each
// claim gets a distinct temp. The copy lands here, then moves into the file's id
// slot; a temp left behind by a reclaimed claim can't collide with the live one.
function fsTempUri(fileId: string, token: string): string {
  return `${fsStorageDirectoryUri}/${fileId}.${token}.tmp`
}

// Replace whatever is in the file's id slot with a finished temp.
async function publish(tempUri: string, targetUri: string): Promise<void> {
  if (await RNFS.exists(targetUri)) {
    await RNFS.unlink(targetUri)
  }
  await RNFS.moveFile(tempUri, targetUri)
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
    async removeByPath(path) {
      if (await RNFS.exists(path)) {
        await RNFS.unlink(path)
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
    async importCopy(file, sourceUri, opts) {
      const targetUri = fsFileUri(file.id, file.type)
      // Land the bytes in this claim's temp, then publish into the slot. The
      // token-scoped temp name means a stale-then-reclaimed row writes its own
      // temp, so the id slot never has two concurrent writers.
      const tempUri = fsTempUri(file.id, opts.claimToken)
      if (await RNFS.exists(tempUri)) {
        await RNFS.unlink(tempUri)
      }

      // A staged file is app-owned, so move it (one write) instead of copying. On
      // failure, fall through to a copy; the scanner's hash pass covers the hash a
      // move doesn't produce.
      if (opts.move && !sourceUri.startsWith('asset://')) {
        try {
          await RNFS.moveFile(fileUriToPath(sourceUri), fileUriToPath(tempUri))
          await publish(tempUri, targetUri)
          const stat = await RNFS.stat(targetUri)
          return { uri: targetUri, size: stat.size }
        } catch {
          // fall through to a copy
        }
      }

      // The native copy reads the bytes once and returns their hash and mime,
      // saving a second full read; it deletes the temp on any failure.
      const result = await copyImportFile(sourceUri, fileUriToPath(tempUri), {
        signal: opts.signal,
        onProgress: opts.onProgress,
      })
      await publish(tempUri, targetUri)
      return { uri: targetUri, size: result.size, sha256: result.sha256, mime: result.mime }
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
    async renameToType(file, newType) {
      const oldUri = fsFileUri(file.id, file.type)
      const newUri = fsFileUri(file.id, newType)
      if (oldUri === newUri) return { uri: oldUri }
      if (!(await RNFS.exists(oldUri))) {
        // oldUri missing — only treat as success if newUri exists
        // (idempotent retry), otherwise the caller will record a DB
        // type for which no file is on disk.
        if (await RNFS.exists(newUri)) return { uri: newUri }
        throw new Error(`renameToType: neither ${oldUri} nor ${newUri} exists`)
      }
      if (await RNFS.exists(newUri)) {
        // Swallow ENOENT if a concurrent scanner pass dropped the
        // destination between our exists check and unlink.
        try {
          await RNFS.unlink(newUri)
        } catch {
          // Best effort; rename below will fail loudly if newUri remains.
        }
      }
      await RNFS.moveFile(oldUri, newUri)
      return { uri: newUri }
    },
    async list() {
      if (!(await RNFS.exists(fsStorageDirectoryUri))) return []
      const entries = await RNFS.readDir(fsStorageDirectoryUri)
      const now = Date.now()
      // A `.tmp` file is an in-flight scanner copy. Surface it to the orphan sweep
      // only once it is older than the stale-claim window, so a copy still in
      // progress is not mistaken for an abandoned one.
      return entries
        .filter((e) => e.isFile())
        .filter((e) => {
          if (!e.path.endsWith('.tmp')) return true
          const mtimeMs = e.mtime instanceof Date ? e.mtime.getTime() : 0
          return now - mtimeMs >= IMPORT_STALE_CLAIM_MS
        })
        .map((e) => e.path)
    },
    async ensureDirectory() {
      if (!(await RNFS.exists(fsStorageDirectoryUri))) {
        await RNFS.mkdir(fsStorageDirectoryUri)
      }
    },
    async getDeviceSpace() {
      // RNFS.getFSInfo reports statfs free blocks, which include the root
      // reserve the app can never write (hundreds of MB on a real device), so
      // the storage gates would trip late. getFreeDiskStorageAsync reports
      // usable space: getAvailableBytes on Android, available-for-important-
      // usage on iOS.
      const [free, info] = await Promise.all([getFreeDiskStorageAsync(), RNFS.getFSInfo()])
      return { freeBytes: free, totalBytes: info.totalSpace }
    },
  }
}
