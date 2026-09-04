/*
 * Where the daemon keeps its library, from this side of the socket.
 *
 * The daemon resolves this for itself and honours `SIA_DATA_DIR`; reading the
 * same variable here is what keeps the two pointing at one library when someone
 * runs the daemon against a scratch directory.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

export function dataDir(): string {
  return process.env.SIA_DATA_DIR || join(homedir(), '.sia')
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
