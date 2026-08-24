import { logger } from '@siastorage/logger'
import type { AppService } from '../app/service'
import { extFromMime, getMimeTypeFromExtension } from '../lib/fileTypes'
import { yieldToEventLoop } from '../lib/yieldToEventLoop'

const BATCH_SIZE = 50

export type OrphanScannerResult = {
  removed: number
  /** Files moved back to the extension their `files` row's type implies. */
  repaired: number
}

function extractFileIdFromName(name: string): string | null {
  // Adapters may return absolute paths (the mobile adapter does); the id is
  // always the basename minus its extension.
  const slash = name.lastIndexOf('/')
  if (slash !== -1) name = name.slice(slash + 1)
  // Claim-scoped import temp: `<id>.<token>.tmp`. The base id (not `<id>.<token>`)
  // is what backs the import_files / files exemption, so strip both the `.tmp`
  // and the `.<token>`; otherwise a live in-flight temp keys off a non-existent
  // id, the in-flight exemption misses it, and a copy in progress gets deleted.
  if (name.endsWith('.tmp')) {
    const base = name.slice(0, -'.tmp'.length)
    const dotIndex = base.lastIndexOf('.')
    if (dotIndex === -1) return base || null
    return base.slice(0, dotIndex) || null
  }
  const dotIndex = name.lastIndexOf('.')
  if (dotIndex === -1) return name || null
  return name.slice(0, dotIndex) || null
}

function basename(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? path : path.slice(slash + 1)
}

function extOf(path: string): string {
  const name = basename(path)
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot)
}

/**
 * Scans the local file system for files not indexed in the database and deletes them.
 * Files may be orphaned from a different account, previous app version, or interrupted operations.
 * Processes in batches, yielding to the event loop between each.
 *
 * Also the repair pass for type drift: bytes at a stale extension look like
 * an orphan from disk. When they are a live `files` row's only copy they are
 * moved back into place with their fs row rebuilt, and when a copy already
 * sits at the right path the stale one is deleted.
 *
 * Suspension signal policy: accepts AbortSignal. DB + disk write loop —
 * removes orphaned files and metadata in batches. Checks the signal at
 * the batch boundary and per-row so a mid-scan abort releases promptly
 * before the DB gate closes.
 */
export async function runOrphanScanner(
  app: AppService,
  onProgress?: (removed: number, total: number) => void,
  signal?: AbortSignal,
): Promise<OrphanScannerResult | undefined> {
  const files = await app.fs.listFiles()
  if (files.length === 0) return undefined

  let removed = 0
  let repaired = 0
  // Lets a drifted file tell whether the slot it belongs in is already taken.
  const present = new Set(files.map(basename))

  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    if (signal?.aborted) break
    const batch = files.slice(i, i + BATCH_SIZE)

    const entries = batch
      .map((name) => ({ name, fileId: extractFileIdFromName(name) }))
      .filter((e): e is { name: string; fileId: string } => e.fileId !== null)

    const orphanedIds = await app.fs.findOrphanedFileIds(entries.map((e) => e.fileId))
    // A claim temp is judged by in-flight import rows alone: its base id may
    // belong to a finalized file (a copy that lost its claim before a retry
    // succeeded), and the files row would otherwise protect the leftover temp
    // forever.
    const tmpIds = entries.filter((e) => e.name.endsWith('.tmp')).map((e) => e.fileId)
    const inFlightIds = await app.fs.inFlightImportFileIds(tmpIds)
    const liveTypes = await app.fs.liveFileTypes(
      entries.filter((e) => !e.name.endsWith('.tmp')).map((e) => e.fileId),
    )
    // Ids still holding bytes at the end of the batch; the meta sweep below
    // must not drop the row for a file it deliberately kept.
    const keptIds = new Set<string>()

    for (const entry of entries) {
      if (signal?.aborted) break

      if (entry.name.endsWith('.tmp')) {
        if (inFlightIds.has(entry.fileId)) continue
        try {
          // Past the mtime gate (`list()` withholds recent temps). Delete by
          // literal path: `<id>.<token>.tmp` can't be rebuilt from id + type.
          await app.fs.removeFileByPath(entry.name)
          removed++
        } catch (error) {
          logger.error('orphanScanner', 'delete_failed', {
            fileId: entry.fileId,
            error: error as Error,
          })
        }
        continue
      }

      const liveType = liveTypes.get(entry.fileId)
      if (liveType === undefined) {
        if (!orphanedIds.has(entry.fileId)) continue
        try {
          const type = getMimeTypeFromExtension(entry.name) ?? 'application/octet-stream'
          await app.fs.removeFile({ id: entry.fileId, type })
          removed++
        } catch (error) {
          logger.error('orphanScanner', 'delete_failed', {
            fileId: entry.fileId,
            error: error as Error,
          })
        }
        continue
      }

      keptIds.add(entry.fileId)
      const wantExt = extFromMime(liveType)
      const haveExt = extOf(entry.name)
      if (haveExt === wantExt) {
        // In place. A missing fs row is a crash between the byte write and
        // the row write; rebuild it rather than delete a referenced file.
        if (orphanedIds.has(entry.fileId)) {
          await app.fs.getFileUri({ id: entry.fileId, type: liveType }).catch(() => null)
        }
        continue
      }

      const target = `${entry.fileId}${wantExt}`
      if (present.has(target)) {
        // The row already resolves to real bytes, so these are a leftover
        // second copy.
        try {
          await app.fs.removeFileByPath(entry.name)
          present.delete(basename(entry.name))
          removed++
        } catch (error) {
          logger.error('orphanScanner', 'delete_failed', {
            fileId: entry.fileId,
            error: error as Error,
          })
        }
        continue
      }

      // Every writer derives the path from extFromMime, so an extension that
      // does not round-trip is not a path this code wrote. Leave it. `.bin` is
      // the exception: it is extFromMime's fallback for a type that names no
      // format, so it is a path this code writes but nothing maps back from.
      const diskType =
        haveExt === '.bin' ? 'application/octet-stream' : getMimeTypeFromExtension(entry.name)
      if (!diskType || extFromMime(diskType) !== haveExt) {
        logger.warn('orphanScanner', 'type_drift_unrepairable', {
          fileId: entry.fileId,
          name: entry.name,
          type: liveType,
        })
        continue
      }
      try {
        await app.fs.renameToType({ id: entry.fileId, type: diskType }, liveType)
        // Rebuild the fs row; its absence is what hid the file.
        await app.fs.getFileUri({ id: entry.fileId, type: liveType })
        present.add(target)
        repaired++
        logger.info('orphanScanner', 'type_drift_repaired', {
          fileId: entry.fileId,
          from: haveExt,
          to: wantExt,
        })
      } catch (error) {
        logger.error('orphanScanner', 'repair_failed', {
          fileId: entry.fileId,
          error: error as Error,
        })
      }
    }

    const metaToDrop = [...orphanedIds].filter((id) => !keptIds.has(id))
    if (metaToDrop.length > 0) {
      await app.fs.deleteMetaBatch(metaToDrop)
    }

    onProgress?.(removed, files.length)

    await yieldToEventLoop()
  }

  logger.info('orphanScanner', 'summary', {
    removed,
    repaired,
    total: files.length,
    aborted: signal?.aborted ?? false,
  })
  return { removed, repaired }
}
