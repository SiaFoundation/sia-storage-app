import { logger } from '@siastorage/logger'
import type { AppService } from '../app/service'
import { BackoffTracker } from '../lib/backoffTracker'

const MAX_PER_TICK = 20

export type ImportScannerResult = {
  finalized: number
  failed: number
  lost: number
  skipped: number
}

export type ResolveLocalIdResult =
  | { status: 'resolved'; uri: string }
  | { status: 'deleted' }
  | { status: 'unavailable' }
export type ResolveLocalId = (localId: string) => Promise<ResolveLocalIdResult>
export type CalculateContentHash = (uri: string) => Promise<string | null>
export type GetMimeType = (opts: { name?: string; uri?: string }) => Promise<string>

export class ImportScanner {
  private app: AppService | null = null
  private processingFiles = new Set<string>()
  private backoff = new BackoffTracker()
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
    this.backoff.reset()
  }

  isInitialized(): boolean {
    return this.app !== null
  }

  isFileBeingProcessed(fileId: string): boolean {
    return this.processingFiles.has(fileId)
  }

  private getApp(): AppService {
    if (!this.app) throw new Error('ImportScanner not initialized')
    return this.app
  }

  /**
   * Finalizes placeholder files (hash: '') in two phases:
   *
   * Phase 1 — requires hash: file is already on disk (user import, camera
   * capture, or background copy). Just hash and update the record.
   * Always runs regardless of backpressure — the source may be a
   * temp file that gets cleaned up, so delaying risks data loss.
   *
   * Phase 2 — requires copy and hash: file has a localId but no local copy
   * (archive sync placeholder). Copy from the media library, then hash.
   * Throttled by maxDeferred to avoid filling device storage faster
   * than uploads drain it. When maxDeferred=0, this phase is skipped.
   *
   * Files that fail transiently (unavailable cloud content, copy errors,
   * hash errors) enter the BackoffTracker and are excluded from queries
   * on subsequent ticks until their backoff expires (5m → 15m → 60m cap).
   *
   * Files that cannot be recovered (deleted from device, no local file
   * and no localId) are marked with lostReason for the UI.
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

      const excludeIds = this.backoff.getExcludeIds()
      const excludeOpt = excludeIds.length > 0 ? excludeIds : undefined

      // Phase 1: files already on disk, just need hashing.
      if (!signal?.aborted) {
        const localCandidates = await app.files.query({
          hashEmpty: true,
          fileExistsLocally: true,
          activeOnly: true,
          limit: MAX_PER_TICK,
          order: 'DESC',
          orderBy: 'addedAt',
          excludeIds: excludeOpt,
        })

        if (localCandidates.length > 0) {
          logger.debug('importScanner', 'tick_local', {
            candidates: localCandidates.length,
          })
        }

        for (const file of localCandidates) {
          if (signal?.aborted) break
          if (this.processingFiles.has(file.id)) {
            result.skipped++
            continue
          }

          this.processingFiles.add(file.id)
          try {
            const localFileUri = await app.fs.getFileUri({
              id: file.id,
              type: file.type,
            })
            if (!localFileUri) {
              result.skipped++
              continue
            }
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
              this.backoff.clear(file.id)
            } else {
              this.backoff.recordSkip(file.id)
              result.failed++
            }
          } catch (e) {
            logger.error('importScanner', 'process_error', {
              fileId: file.id,
              error: e as Error,
            })
            this.backoff.recordSkip(file.id)
            result.failed++
          } finally {
            this.processingFiles.delete(file.id)
          }
        }
      }

      // Phase 2: files needing copy from media library, throttled by maxDeferred.
      const effectiveMaxDeferred = maxDeferred ?? Infinity
      if (!signal?.aborted && effectiveMaxDeferred > 0) {
        const deferredLimit =
          effectiveMaxDeferred === Infinity
            ? MAX_PER_TICK
            : Math.min(effectiveMaxDeferred, MAX_PER_TICK)

        const deferredCandidates = await app.files.query({
          hashEmpty: true,
          fileExistsLocally: false,
          activeOnly: true,
          limit: deferredLimit,
          order: 'DESC',
          orderBy: 'addedAt',
          excludeIds: excludeOpt,
        })

        if (deferredCandidates.length > 0) {
          logger.debug('importScanner', 'tick_deferred', {
            candidates: deferredCandidates.length,
          })
        }

        for (const file of deferredCandidates) {
          if (signal?.aborted) break
          if (this.processingFiles.has(file.id)) {
            result.skipped++
            continue
          }

          this.processingFiles.add(file.id)
          try {
            if (file.localId && resolveLocalId) {
              const resolved = await resolveLocalId(file.localId)
              if (resolved.status === 'deleted') {
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
              if (resolved.status === 'unavailable') {
                logger.debug('importScanner', 'localId_content_unavailable', {
                  fileId: file.id,
                  localId: file.localId,
                })
                this.backoff.recordSkip(file.id)
                result.skipped++
                continue
              }

              try {
                // Exit early on suspension before starting file copy + hash.
                if (signal?.aborted) break
                const uri = await app.fs.copyFile({ id: file.id, type: file.type }, resolved.uri)
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
                  this.backoff.clear(file.id)
                } else {
                  this.backoff.recordSkip(file.id)
                  result.failed++
                }
              } catch (e) {
                logger.error('importScanner', 'copy_from_localId_failed', {
                  fileId: file.id,
                  error: e as Error,
                })
                this.backoff.recordSkip(file.id)
                result.failed++
              }
              continue
            }

            if (file.localId) {
              logger.debug('importScanner', 'skipped_no_resolver', {
                fileId: file.id,
              })
              this.backoff.recordSkip(file.id)
              result.skipped++
              continue
            }

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
            this.backoff.recordSkip(file.id)
            result.failed++
          } finally {
            this.processingFiles.delete(file.id)
          }
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
