/*
 * The identity this build was signed with.
 *
 * The domain, the name Finder shows and the extension's bundle id have to match
 * the signature, and signing happens per context: a development build and a
 * distributed one carry different bundle ids and therefore different containers.
 * Written beside the bundled app at packaging time for that reason.
 *
 * A checkout has no such file and falls back to the development identity, which
 * is the one a checkout can reach.
 */

import { app } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { log } from './log'

export type DesktopConfig = {
  /** Stable identifier for the mount, so a restart reattaches rather than duplicating. */
  domainId: string
  /** What the file manager shows in its sidebar. */
  displayName: string
  /** Names the container the daemon and the extension meet in. */
  extensionBundleId: string
}

const DEVELOPMENT: DesktopConfig = {
  domainId: 'sia-dev',
  displayName: 'Sia Storage Dev',
  extensionBundleId: 'sia.storage.desktop.dev.file-provider',
}

let cached: DesktopConfig | null = null

export function desktopConfig(): DesktopConfig {
  if (cached) return cached
  cached = read()
  return cached
}

function read(): DesktopConfig {
  const path = join(app.getAppPath(), 'config.json')
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<DesktopConfig>
    if (!parsed.domainId || !parsed.displayName || !parsed.extensionBundleId) {
      throw new Error('missing a field')
    }
    return parsed as DesktopConfig
  } catch (e) {
    log.info(`no packaged config at ${path} (${(e as Error).message}), using the dev identity`)
    return DEVELOPMENT
  }
}
