import * as fs from 'fs'

/**
 * Liveness breadcrumb the daemon writes to disk so a CLI client can
 * answer "is the daemon alive and where do I reach it?" without opening
 * a socket. App state (sync, uploads, etc.) is NOT written here — clients
 * fetch it through the AppService IPC proxy instead.
 */
export type DaemonState = {
  pid: number
  startedAt: number
  connected: boolean
}

export function readState(statePath: string): DaemonState | null {
  try {
    const raw = fs.readFileSync(statePath, 'utf-8')
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    return parsed as DaemonState
  } catch {
    return null
  }
}

export function writeState(statePath: string, state: DaemonState): void {
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2))
}

export function removeState(statePath: string): void {
  try {
    fs.unlinkSync(statePath)
  } catch {
    // may not exist
  }
}
