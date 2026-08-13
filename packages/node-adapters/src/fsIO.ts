import { extFromMime } from '@siastorage/core/lib/fileTypes'
import type { FsIOAdapter } from '@siastorage/core/services/fsFileUri'
import { createHash } from 'crypto'
import { constants, createWriteStream } from 'fs'
import * as fs from 'fs/promises'
import * as path from 'path'
import { pipeline } from 'stream/promises'

export function createNodeFsIO(filesDir: string): FsIOAdapter {
  function filePath(fileId: string, type: string): string {
    const ext = extFromMime(type)
    return path.join(filesDir, `${fileId}${ext}`)
  }

  // Overloaded to match the adapter contract: hashed by default, size-only with
  // { hash: false }. A single union-returning function does not satisfy the
  // overloaded interface property, so the signatures live here.
  async function adoptFile(
    file: { id: string; type: string },
    sourceUri: string,
  ): Promise<{ uri: string; size: number; hash: string }>
  async function adoptFile(
    file: { id: string; type: string },
    sourceUri: string,
    opts: { hash: false },
  ): Promise<{ uri: string; size: number }>
  async function adoptFile(
    file: { id: string; type: string },
    sourceUri: string,
    opts?: { hash: false },
  ): Promise<{ uri: string; size: number; hash?: string }> {
    const target = filePath(file.id, file.type)
    const source = sourceUri.replace(/^file:\/\//, '')
    // O_NOFOLLOW refuses a symlink at open time, with no check-then-swap window
    // an lstat would leave; a link would otherwise read a file outside staging.
    let staged: fs.FileHandle
    try {
      staged = await fs.open(source, constants.O_RDONLY | constants.O_NOFOLLOW)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ELOOP') {
        throw new Error(`Refusing to adopt a symbolic link: ${source}`)
      }
      throw e
    }
    // Rename consumes the staged temp with no byte copy on the same volume.
    try {
      try {
        await fs.rename(source, target)
      } catch {
        // Cross-volume: copy from the open descriptor (copyFile follows links,
        // this cannot). rm+'wx' so a symlink recreated at the target can't be
        // written through, while surfacing a real rm failure (EACCES/EPERM).
        await fs.rm(target, { force: true })
        await pipeline(
          staged.createReadStream({ autoClose: false }),
          createWriteStream(target, { flags: 'wx' }),
        )
        await fs.unlink(source).catch(() => {})
      }
    } finally {
      await staged.close()
    }
    // Re-check after the move: the target dir is process-private, so a link
    // here (unlike at the source) cannot have been swapped in by another writer.
    if ((await fs.lstat(target)).isSymbolicLink()) {
      await fs.unlink(target).catch(() => {})
      throw new Error(`Refusing to adopt a symbolic link: ${source}`)
    }
    if (opts?.hash === false) {
      const stat = await fs.stat(target)
      return { uri: target, size: stat.size }
    }
    const hash = createHash('sha256')
    const handle = await fs.open(target, 'r')
    try {
      const buffer = Buffer.allocUnsafe(64 * 1024)
      let position = 0
      while (true) {
        const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, position)
        if (bytesRead === 0) break
        hash.update(buffer.subarray(0, bytesRead))
        position += bytesRead
      }
    } finally {
      await handle.close()
    }
    const stat = await fs.stat(target)
    return { uri: target, size: stat.size, hash: `sha256:${hash.digest('hex')}` }
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
      await fs.copyFile(sourceUri.replace(/^file:\/\//, ''), target)
      const stat = await fs.stat(target)
      return { uri: target, size: stat.size }
    },

    // No single-read hash here; the scanner's hash pass covers it.
    async importCopy(file, sourceUri, opts) {
      const target = filePath(file.id, file.type)
      const sourcePath = sourceUri.replace(/^file:\/\//, '')
      if (opts.move) {
        // Staged temps are consumed by the move; rename falls back to
        // copy+unlink across filesystems.
        try {
          await fs.rename(sourcePath, target)
        } catch {
          await fs.copyFile(sourcePath, target)
          await fs.unlink(sourcePath).catch(() => {})
        }
      } else {
        await fs.copyFile(sourcePath, target)
      }
      const stat = await fs.stat(target)
      return { kind: 'plain' as const, uri: target, size: stat.size }
    },

    adoptFile,

    async exportTo(file, destPath) {
      const source = filePath(file.id, file.type)
      const stat = await fs.stat(source)
      // Unlinked first: link(2) refuses an existing destination, and a symlink
      // sitting at one would otherwise be followed by the copy fallback.
      await fs.rm(destPath, { force: true })
      try {
        // Same volume: the destination becomes a second name for the same
        // inode, so no bytes move at all. The reader gets a stable view even
        // if the managed copy is evicted while it reads.
        await fs.link(source, destPath)
      } catch {
        // Different volume, or a filesystem without hardlinks.
        await fs.copyFile(source, destPath)
      }
      return stat.size
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

    async getDeviceSpace() {
      // Report the real filesystem free/total when available so headless
      // hosts (CLI) reflect the device; fall back to an ample constant (1 TB)
      // if statfs is unavailable, so the paced throttle never spuriously defers.
      try {
        const st = await fs.statfs(filesDir)
        return {
          freeBytes: st.bavail * st.bsize,
          totalBytes: st.blocks * st.bsize,
        }
      } catch {
        const ONE_TB = 1024 ** 4
        return { freeBytes: ONE_TB, totalBytes: ONE_TB }
      }
    },
  }
}
