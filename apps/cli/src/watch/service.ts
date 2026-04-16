import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '@siastorage/logger'
import type { CliApp } from '../app'
import { ingestFile } from '../lib/ingestFile'
import { isScreenshotFile, renameScreenshot } from './rename'

export type WatchRule = {
  source: string
  targetDir: string
  pattern?: string
  appendId?: boolean
}

const WATCH_RULES_KEY = 'watchRules'

export async function getWatchRules(app: CliApp): Promise<WatchRule[]> {
  const raw = await app.service.storage.getItem(WATCH_RULES_KEY)
  if (!raw) return []
  try {
    return JSON.parse(raw)
  } catch {
    return []
  }
}

export async function setWatchRules(app: CliApp, rules: WatchRule[]): Promise<void> {
  await app.service.storage.setItem(WATCH_RULES_KEY, JSON.stringify(rules))
}

function matchesPattern(name: string, pattern?: string): boolean {
  if (!pattern) return true
  // Simple glob: only supports * as wildcard
  const regex = new RegExp(
    '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$',
  )
  return regex.test(name)
}

/**
 * Watch worker — called by the scheduler on each tick.
 * Scans watched directories for new files and ingests them.
 */
export async function watchWorker(app: CliApp, signal: AbortSignal): Promise<void> {
  const rules = await getWatchRules(app)
  if (rules.length === 0) return

  for (const rule of rules) {
    if (signal.aborted) return

    let entries: string[]
    try {
      entries = readdirSync(rule.source)
    } catch (e) {
      logger.warn('watch', 'read_dir_failed', {
        source: rule.source,
        error: e instanceof Error ? e.message : String(e),
      })
      continue
    }

    for (const entry of entries) {
      if (signal.aborted) return
      if (!matchesPattern(entry, rule.pattern)) continue

      const fullPath = join(rule.source, entry)
      let stat
      try {
        stat = statSync(fullPath)
      } catch {
        continue
      }
      if (!stat.isFile()) continue

      const data = readFileSync(fullPath)
      const hash = createHash('sha256').update(data).digest('hex')
      const existing = await app.service.files.getByContentHash(hash)
      if (existing) continue

      // Determine the ingestion name
      let name: string | undefined
      if (rule.appendId && isScreenshotFile(entry)) {
        name = renameScreenshot(entry)
      }

      try {
        const result = await ingestFile(app, {
          filePath: fullPath,
          directory: rule.targetDir,
          name,
        })
        logger.info('watch', 'ingested', {
          source: fullPath,
          name: result.name,
          id: result.id,
        })
      } catch (e) {
        logger.warn('watch', 'ingest_failed', {
          file: fullPath,
          error: e instanceof Error ? e.message : String(e),
        })
      }
    }
  }
}
