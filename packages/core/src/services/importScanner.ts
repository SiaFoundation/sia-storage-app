import { logger } from '@siastorage/logger'
import type { AppService } from '../app/service'

const MAX_PER_TICK = 20
const ERROR_COOLDOWN_MS = 5 * 60 * 1000 // 5 minutes

export type ImportScannerResult = {
  finalized: number
  failed: number
  lost: number
  skipped: number
}

export type ResolveLocalId = (localId: string) => Promise<string | null>
export type CalculateContentHash = (uri: string) => Promise<string | null>
export type GetMimeType = (opts: { name?: string; uri?: string }) => Promise<string>

export class ImportScanner {
  private app: AppService | null = null
  private processingFiles = new Set<string>()
  private erroredFiles = new Map<string, number>()
  private _calculateContentHash: CalculateContentHash | null = null
  private _getMimeType: GetMimeType | null = null

  initialize(
    app: AppService,
    calculateContentHash: CalculateContentHash,
    getMimeType: GetMimeType,
  ): void {
    this.app = app
    this._calculateContentHash = calculateContentHash
    this._getMimeType = getMimeType
  }

  reset(): void {
    this.app = null
    this._calculateContentHash = null
    this._getMimeType = null
    this.processingFiles.clear()
    this.erroredFiles.clear()
  }

  isInitialized(): boolean {
    return this.app !== null
  }

  isFileBeingProcessed(fileId: string): boolean {
    return this.processingFiles.has(fileId)
  }

  isFileInErrorCooldown(fileId: string): boolean {
    const lastError = this.erroredFiles.get(fileId)
    if (!lastError) return false
    const elapsed = Date.now() - lastError
    if (elapsed >= ERROR_COOLDOWN_MS) {
      this.erroredFiles.delete(fileId)
      return false
    }
    return true
  }

  private markFileErrored(fileId: string): void {
    this.erroredFiles.set(fileId, Date.now())
  }

  private getApp(): AppService {
    if (!this.app) throw new Error('ImportScanner not initialized')
    return this.app
  }

  /**
   * Finalizes placeholder files (hash: '') in two passes:
   *
   * 1. File already on disk (importFiles background copy landed, or
   *    manually added): hash the local file and update the record.
   *    Always processed — no I/O pressure since the file is local.
   *
   * 2. File has localId but no local copy (catalogAssets placeholder):
   *    copy from the media library, then hash. Throttled by maxDeferred
   *    to avoid filling device storage faster than uploads drain it.
   *
   * Files that cannot be recovered (localId doesn't resolve, no local
   * file and no localId) are marked with lostReason so the UI can
   * surface them to the user.
   */
  async runScan(
    signal?: AbortSignal,
    resolveLocalId?: ResolveLocalId,
    maxDeferred?: number,
  ): Promise<ImportScannerResult> {
    const app = this.getApp()
    const result: ImportScannerResult = {
      finalized: 0,
      failed: 0,
      lost: 0,
      skipped: 0,
    }

    try {
      const candidates = await app.files.query({
        hashEmpty: true,
        activeOnly: true,
        limit: MAX_PER_TICK,
        order: 'DESC',
        orderBy: 'addedAt',
      })

      if (candidates.length === 0) return result

      logger.debug('importScanner', 'tick', { candidates: candidates.length })

      const effectiveMaxDeferred = maxDeferred ?? Infinity
      let deferredProcessed = 0

      const updates: Array<{
        id: string
        hash: string
        size: number
        type: string
      }> = []
      const lostUpdates: Array<{
        id: string
        lostReason: string
      }> = []

      for (const file of candidates) {
        if (signal?.aborted) break

        if (this.processingFiles.has(file.id)) {
          result.skipped++
          continue
        }

        if (this.isFileInErrorCooldown(file.id)) {
          result.skipped++
          continue
        }

        this.processingFiles.add(file.id)
        try {
          const localFileUri = await app.fs.getFileUri({
            id: file.id,
            type: file.type,
          })

          // Pass 1: local file on disk — hash and finalize.
          if (localFileUri) {
            // Exit early on suspension before starting CPU-intensive hash.
            if (signal?.aborted) break
            const outcome = await this.hashExistingFile(file, localFileUri)
            if (outcome.action === 'finalized') {
              updates.push({
                id: file.id,
                hash: outcome.hash,
                size: outcome.size,
                type: outcome.type,
              })
              result.finalized++
            } else {
              this.markFileErrored(file.id)
              result.failed++
            }
            continue
          }

          // Pass 2: has localId, no local file — copy from media library
          // then hash. Throttled by maxDeferred to limit storage pressure.
          if (file.localId && resolveLocalId) {
            if (deferredProcessed >= effectiveMaxDeferred) {
              result.skipped++
              continue
            }
            deferredProcessed++

            const resolvedUri = await resolveLocalId(file.localId)
            if (!resolvedUri) {
              logger.debug('importScanner', 'localId_not_resolved', {
                fileId: file.id,
                localId: file.localId,
              })
              lostUpdates.push({
                id: file.id,
                lostReason: 'Source photo deleted from device',
              })
              result.lost++
              continue
            }

            try {
              // Exit early on suspension before starting file copy + hash.
              if (signal?.aborted) break
              const uri = await app.fs.copyFile({ id: file.id, type: file.type }, resolvedUri)
              if (signal?.aborted) break
              const outcome = await this.hashExistingFile(file, uri)
              if (outcome.action === 'finalized') {
                updates.push({
                  id: file.id,
                  hash: outcome.hash,
                  size: outcome.size,
                  type: outcome.type,
                })
                result.finalized++
              } else {
                this.markFileErrored(file.id)
                result.failed++
              }
            } catch (e) {
              logger.error('importScanner', 'copy_from_localId_failed', {
                fileId: file.id,
                error: e as Error,
              })
              lostUpdates.push({
                id: file.id,
                lostReason: 'Failed to copy from device',
              })
              result.lost++
            }
            continue
          }

          // Has localId but no resolver available — skip, don't mark lost.
          if (file.localId) {
            result.skipped++
            continue
          }

          // No local file, no localId — orphan.
          logger.debug('importScanner', 'orphan', { fileId: file.id })
          lostUpdates.push({
            id: file.id,
            lostReason: 'No local file or source available',
          })
          result.lost++
        } catch (e) {
          logger.error('importScanner', 'process_error', {
            fileId: file.id,
            error: e as Error,
          })
          this.markFileErrored(file.id)
          result.failed++
        } finally {
          this.processingFiles.delete(file.id)
        }
      }

      if (updates.length > 0) {
        await app.files.updateMany(
          updates.map((u) => ({
            id: u.id,
            hash: u.hash,
            size: u.size,
            type: u.type,
          })),
        )
      }

      if (lostUpdates.length > 0) {
        await app.files.updateMany(
          lostUpdates.map((u) => ({
            id: u.id,
            lostReason: u.lostReason,
          })),
        )
      }

      if (updates.length > 0 || lostUpdates.length > 0) {
        await app.caches.library.invalidateAll()
        app.caches.libraryVersion.invalidate()
      }

      logger.debug('importScanner', 'tick_complete', {
        finalized: result.finalized,
        failed: result.failed,
        lost: result.lost,
        skipped: result.skipped,
      })
    } catch (e) {
      logger.error('importScanner', 'scan_error', { error: e as Error })
    }

    return result
  }

  private async hashExistingFile(
    file: { id: string; name: string; type: string },
    fileUri: string,
  ): Promise<
    | {
        action: 'finalized'
        hash: string
        size: number
        type: string
      }
    | { action: 'failed' }
  > {
    const app = this.getApp()

    let type = file.type
    if (type === 'application/octet-stream' && this._getMimeType) {
      const detected = await this._getMimeType({
        name: file.name,
        uri: fileUri,
      })
      if (detected && detected !== 'application/octet-stream') {
        type = detected
      }
    }

    if (!this._calculateContentHash) {
      return { action: 'failed' }
    }

    const hash = await this._calculateContentHash(fileUri)
    if (!hash) {
      logger.warn('importScanner', 'hash_failed', { fileId: file.id })
      return { action: 'failed' }
    }

    let size: number
    try {
      const meta = await app.fs.readMeta(file.id)
      size = meta?.size ?? 0
    } catch {
      size = 0
    }

    logger.debug('importScanner', 'file_complete', {
      fileId: file.id,
      hash,
      size,
    })

    return { action: 'finalized', hash, size, type }
  }
}
