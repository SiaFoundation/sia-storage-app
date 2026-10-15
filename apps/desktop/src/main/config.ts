/*
 * The identity this build was signed with.
 *
 * The domain, the name Finder shows and the extension's bundle id have to match
 * the signature, and signing happens per context, so a development build and a
 * distributed one land in different containers. Written beside the bundled app
 * at packaging time. A checkout has no such file and uses the development
 * identity, which is the one it can reach.
 */

import { app } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { log } from './log'
import type { UpdateChannel } from './updateFeed'

export type DesktopConfig = {
  /** Stable identifier for the mount, so a restart reattaches rather than duplicating. */
  domainId: string
  /** What the file manager shows in its sidebar. */
  displayName: string
  /** Names the container the daemon and the extension meet in. */
  extensionBundleId: string
  /**
   * The build the bundled daemon was compiled with. Absent in a checkout,
   * which runs whatever daemon it is pointed at and so has nothing to compare.
   */
  daemonBuild?: string
  /**
   * Where this build looks for its own updates. Absent unless packaging set
   * `SIA_UPDATE_CHANNEL`, which beta and prod do and dev and test do not by
   * default, and from a source run.
   */
  updates?: {
    channel: UpdateChannel
    /** The update zip's file name with `{version}` standing in for the version. */
    asset: string
  }
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
    log.info('config', 'using_dev_identity', { path, error: e as Error })
    return DEVELOPMENT
  }
}
