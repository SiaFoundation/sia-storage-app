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

    async adoptFile(file, sourceUri, opts) {
      const target = filePath(file.id, file.type)
      const source = sourceUri.replace(/^file:\/\//, '')
      // A symlink passes a containment check on its own path and then reads
      // whatever it points at, so it is refused. O_NOFOLLOW rather than an
      // lstat: the open fails outright on a link, which leaves no window in
      // which the path could be swapped for one between the check and the read.
      let staged: fs.FileHandle
      try {
        staged = await fs.open(source, constants.O_RDONLY | constants.O_NOFOLLOW)
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ELOOP') {
          throw new Error(`Refusing to adopt a symbolic link: ${source}`)
        }
        throw e
      }
      // Consumes the source: it is a staged temp whose only purpose was to carry
      // the bytes here, and a rename moves no data when both sides share a
      // volume.
      try {
        try {
          await fs.rename(source, target)
        } catch {
          // Across volumes, copied from the descriptor already open rather than
          // from the path, because copyFile follows a link and this cannot.
          // Remove any existing target first and open exclusively ('wx'): a
          // symlink left at the destination would otherwise be followed and
          // written through, before the post-move lstat check can refuse it.
          // rm with force ignores a missing target but still surfaces a real
          // failure (EACCES/EPERM) rather than masking it.
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
      // Checked again after the move: the first check can be raced by swapping
      // the staged file for a link between lstat and rename. By now the file is
      // in a directory only this process writes, so this one cannot be.
      if ((await fs.lstat(target)).isSymbolicLink()) {
        await fs.unlink(target).catch(() => {})
        throw new Error(`Refusing to adopt a symbolic link: ${source}`)
      }
      if (opts?.hash === false) {
        const stat = await fs.stat(target)
        return { kind: 'plain', uri: target, size: stat.size }
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
      return { kind: 'hashed', uri: target, size: stat.size, hash: `sha256:${hash.digest('hex')}` }
    },

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
      // Report the real filesystem free bytes when available so headless hosts
      // (CLI) reflect the device; fall back to an ample constant (1 TB) if
      // statfs is unavailable, so the paced throttle never spuriously defers.
      try {
        const st = await fs.statfs(filesDir)
        return { freeBytes: st.bavail * st.bsize }
      } catch {
        return { freeBytes: 1024 ** 4 }
      }
    },
  }
}
