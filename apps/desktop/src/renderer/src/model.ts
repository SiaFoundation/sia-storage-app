/*
 * What the tray says about the library, as plain values.
 *
 * Nothing here reads anything: every function takes a `Status` and returns a
 * string, a number or a colour. That keeps the wording and the order of
 * precedence testable without a bridge, a window or a running daemon.
 */

export type DomainState = 'absent' | 'starting' | 'mounted' | 'error' | 'unsupported'

export type Status = {
  fileCount: number
  libraryBytes: number
  /**
   * Objects the current sync-up run has attempted, out of `uploadsTotal`. A
   * failed object is re-counted on the next pass, so this can pass the total
   * under sustained retries and every reader below clamps it.
   */
  uploadsDone: number
  uploadsTotal: number
  uploadsPending: number
  syncingDown: boolean
  /** 0..1. Sync-down reports a fraction rather than a count, so it has no total. */
  downloadProgress: number
  connected: boolean
  /** Why the daemon is not connected, when it knows. Null while it is trying. */
  connectionError: string | null
  indexerUrl: string
  domain: DomainState
  daemonReachable: boolean
  mountPath: string | null
  materializing: Materializing
}

/** How far the OS shell has got through writing the library out. */
export type Materializing = { active: boolean; done: number; total: number }

/** Never past the total, so a retry pass cannot read as finished or overflow. */
const uploadsDone = (s: Status): number => Math.min(s.uploadsDone, s.uploadsTotal)

// `!==` rather than `<`: a run whose attempts have passed the total is still
// running, and `<` would drop the whole transfer row mid-retry.
export const transferInFlight = (s: Status): boolean =>
  s.syncingDown || (s.uploadsTotal > 0 && s.uploadsDone !== s.uploadsTotal)

export const transferLabel = (s: Status): string => (s.syncingDown ? 'Downloading' : 'Uploading')

/** Empty while downloading: sync-down knows its progress but not how many objects. */
export const transferCount = (s: Status): string =>
  !s.syncingDown && s.uploadsTotal > 0 ? `${uploadsDone(s)} of ${s.uploadsTotal}` : ''

export const transferProgress = (s: Status): number => {
  if (s.syncingDown) return s.downloadProgress
  return s.uploadsTotal > 0 ? uploadsDone(s) / s.uploadsTotal : 0
}

export const fileCountLabel = (s: Status): string => s.fileCount.toLocaleString()

export const librarySizeLabel = (s: Status): string =>
  s.libraryBytes > 0 ? formatBytes(s.libraryBytes) : '-'

// Host only, and a name rather than an echo when that fails: a custom indexer
// URL can carry credentials and a path, and echoing is what would show them.
export const indexerLabel = (s: Status): string => {
  try {
    return new URL(s.indexerUrl).host || 'Custom indexer'
  } catch {
    return 'Custom indexer'
  }
}

export function mountLabel(s: Status): string {
  switch (s.domain) {
    case 'mounted':
      return 'Mounted'
    case 'starting':
      return 'Mounting…'
    case 'error':
      return 'Unavailable'
    case 'unsupported':
      return 'Not in this build'
    default:
      return 'Not mounted'
  }
}

/** Accent means in flight, which the dot animates on, so a steady state stays quiet. */
export function indicator(s: Status): 'red' | 'orange' | 'green' | 'accent' {
  switch (condition(s)) {
    case 'daemon-down':
    case 'mount-error':
      return 'red'
    // Orange is still trying. A reason means it has stopped.
    case 'disconnected':
      return s.connectionError ? 'red' : 'orange'
    case 'transferring':
    case 'preparing':
      return 'accent'
    case 'ok':
      return 'green'
  }
}

/**
 * The one thing worth saying, chosen once.
 *
 * The headline, the line under it and the dot all read this, so they cannot
 * end up describing different problems. Problems outrank progress: a transfer
 * running over a broken mount is still a broken mount.
 */
type Condition =
  | 'daemon-down'
  | 'disconnected'
  | 'mount-error'
  | 'transferring'
  | 'preparing'
  | 'ok'

function condition(s: Status): Condition {
  if (!s.daemonReachable) return 'daemon-down'
  if (!s.connected) return 'disconnected'
  if (s.domain === 'error') return 'mount-error'
  if (transferInFlight(s)) return 'transferring'
  // Below a transfer: someone's files moving matters more than a one-off pass
  // the system makes over a library that already works.
  if (s.materializing.active) return 'preparing'
  return 'ok'
}

export function activity(s: Status): string {
  switch (condition(s)) {
    case 'daemon-down':
      return 'Not running'
    // A reason means the attempt is over, so it stops saying it is still trying.
    case 'disconnected':
      return s.connectionError ? 'Not connected' : 'Connecting'
    case 'mount-error':
      return 'Finder folder unavailable'
    case 'transferring':
      return transferLabel(s)
    case 'preparing':
      return 'Preparing folders'
    case 'ok':
      return 'Up to date'
  }
}

/**
 * What macOS is doing, in the words of someone waiting for it. The count is
 * what the system has written out, not what it has been asked for, so it only
 * ever moves forwards.
 */
function preparingDetail(s: Status): string {
  const { done, total } = s.materializing
  const folders = total > 0 ? `${done} of ${total}` : String(done)
  return `macOS is reading your folders, ${folders} ready`
}

export function activityDetail(s: Status): string | null {
  switch (condition(s)) {
    case 'daemon-down':
      return 'Open logs for the reason'
    case 'disconnected':
      return s.connectionError ?? 'Waiting to reach the indexer'
    case 'mount-error':
      return 'The folder could not be registered with macOS'
    case 'preparing':
      return preparingDetail(s)
    default:
      return null
  }
}

/** Powers of 1000, which is what Finder counts in. */
function formatBytes(bytes: number): string {
  const units = ['kB', 'MB', 'GB', 'TB']
  if (bytes < 1000) return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`
  let value = bytes / 1000
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit += 1
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}
