/*
 * Where the daemon keeps its library, from this side of the socket.
 *
 * The daemon resolves this for itself and honours `SIA_DATA_DIR`; reading the
 * same variable here is what keeps the two pointing at one library when
 * someone runs the daemon against a scratch directory, and the app passes it
 * to the daemon it spawns.
 *
 * A library is per build context, not per machine. The three contexts install
 * side by side and a shared directory would put them on one database, one
 * socket and one account: signing into the beta would sign the dev build in,
 * and whichever daemon came up first would serve both. The shipping build
 * keeps the plain directory, which is the one the CLI uses, because the app
 * and the CLI are meant to reach the same library.
 */

import { app } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** What the shipping build signs as. The others suffix it. */
const RELEASE_BUNDLE_ID = 'sia.storage.desktop'

/**
 * `prod` for the shipping build, otherwise the suffix it was signed under.
 *
 * The name is the bundle id the build was signed with, which packaging writes
 * into the app's own package.json. A source checkout has the workspace name
 * instead and is a development build, matching the identity it falls back to
 * for the mount.
 */
export function buildVariant(): string {
  const name = app.getName()
  if (name === RELEASE_BUNDLE_ID) return 'prod'
  if (name.startsWith(`${RELEASE_BUNDLE_ID}.`)) return name.slice(RELEASE_BUNDLE_ID.length + 1)
  return 'dev'
}

/** `.sia` for the shipping build, `.sia-beta` and `.sia-dev` beside it. */
export function dataDir(): string {
  const variant = buildVariant()
  return (
    process.env.SIA_DATA_DIR || join(homedir(), variant === 'prod' ? '.sia' : `.sia-${variant}`)
  )
}

/** The daemon's database, which exists once it has opened a library. */
export function daemonDbPath(): string {
  return join(dataDir(), 'data.db')
}

/** The daemon's stored settings, a flat JSON object of strings. */
export function daemonStoragePath(): string {
  return join(dataDir(), 'storage.json')
}

export function daemonSocketPath(): string {
  return join(dataDir(), 'daemon.sock')
}

export function daemonLogPath(): string {
  return join(dataDir(), 'daemon.log')
}

export function desktopLogPath(): string {
  return join(dataDir(), 'desktop.log')
}

/**
 * Where the extension's entries are collected to. The extension cannot write
 * here itself: it is sandboxed to its own container and logs through the system
 * instead, so this file is a copy made when someone asks to see the logs.
 */
export function extensionLogPath(): string {
  return join(dataDir(), 'fileprovider.log')
}
