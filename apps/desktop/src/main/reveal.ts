/*
 * Shows a library file selected in its Finder window, from the popover's
 * activity list.
 *
 * The renderer names the file by id and nothing else, and the name and folder
 * are read from the daemon here, so a page cannot point Finder at a path of
 * its choosing. Names arrive from synced metadata another device wrote, which
 * is why a name or folder that would step outside the mount is refused rather
 * than joined.
 */

import { stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { shell } from 'electron'
import { finderPath } from './finderPath'
import { log } from './log'
import { call } from './rpc'

/**
 * How long the file's path gets to answer a stat. A folder Finder has never
 * listed is enumerated by the File Provider extension on first lookup, which
 * waits on the daemon.
 */
const LOOKUP_TIMEOUT_MS = 3_000

async function exists(path: string): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), LOOKUP_TIMEOUT_MS)
  })
  try {
    return await Promise.race([stat(path).then(() => true), timeout])
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Selects the file in Finder. When the system has not written the file out
 * yet, which it does lazily per folder, the folder holding it opens instead,
 * and the mount itself when even that is missing.
 */
export async function revealFile(mount: string, fileId: string): Promise<void> {
  const [file, folder] = (await Promise.all([
    call('ds:files:getById', [fileId]),
    call('ds:directories:getPathForFile', [fileId]),
  ])) as [{ name?: unknown } | null, unknown]
  if (!file || typeof file.name !== 'string') return
  const folderPath = typeof folder === 'string' && folder !== '' ? folder : null

  const path = finderPath(mount, folderPath, file.name)
  if (!path) {
    log.error('shell', 'reveal_refused', { fileId })
    return
  }
  if (await exists(path)) {
    shell.showItemInFolder(path)
    return
  }
  const parent = dirname(path)
  const fallback = parent !== mount && (await exists(parent)) ? parent : mount
  const reason = await shell.openPath(fallback)
  if (reason) log.error('shell', 'open_failed', { path: fallback, reason })
}
