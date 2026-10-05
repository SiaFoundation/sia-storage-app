/*
 * What the tray and the window say about the library, as plain values.
 *
 * Nothing here reads anything: every function takes a `Status` and returns a
 * string, a number or a colour. That keeps the wording and the order of
 * precedence testable without a bridge, a window or a running daemon.
 */

import type { SyncState, UploadEntry } from '@siastorage/core/app'

export type DomainState = 'absent' | 'starting' | 'mounted' | 'error' | 'unsupported'

/** `unknown` until the first read of the daemon's sync state has returned. */
export type SyncGate = SyncState['syncGateStatus'] | 'unknown'

/**
 * The uploads the daemon has in hand. A thumbnail uploads as an object of its
 * own, so it keeps an upload in flight and moves its progress, but the counts
 * a person reads are of files.
 */
export type Uploads = {
  /** Entries being packed or sent, thumbnails included. */
  active: number
  activeFiles: number
  activeFileBytes: number
  /** Entries registered and not yet picked up, thumbnails included. */
  queued: number
  queuedFiles: number
  /** 0..1 across every active entry, weighted by size. */
  progress: number
}

export const NO_UPLOADS: Uploads = {
  active: 0,
  activeFiles: 0,
  activeFileBytes: 0,
  queued: 0,
  queuedFiles: 0,
  progress: 0,
}

export function summarizeUploads(entries: UploadEntry[]): Uploads {
  const summary = { ...NO_UPLOADS }
  let bytes = 0
  let sent = 0
  for (const entry of entries) {
    const isFile = entry.kind !== 'thumb'
    if (entry.status === 'queued') {
      summary.queued += 1
      if (isFile) summary.queuedFiles += 1
    } else if (
      entry.status === 'packing' ||
      entry.status === 'packed' ||
      entry.status === 'uploading'
    ) {
      summary.active += 1
      bytes += entry.size
      sent += entry.progress * entry.size
      if (isFile) {
        summary.activeFiles += 1
        summary.activeFileBytes += entry.size
      }
    }
  }
  summary.progress = bytes > 0 ? sent / bytes : 0
  return summary
}

export type Status = {
  /** Files only. A thumbnail is a row in the same table and is not counted. */
  fileCount: number
  /** Files on this Mac that have no copy on the network yet, uploading or waiting to. */
  filesNotUploaded: number
  folderCount: number
  libraryBytes: number
  uploads: Uploads
  syncingDown: boolean
  /** 0..1. Sync-down reports a fraction rather than a count, so it has no total. */
  syncDownProgress: number
  syncingUp: boolean
  /**
   * Objects the current sync-up run has attempted, out of `syncUpTotal`. A
   * failed object is re-counted on the next pass, so this can pass the total
   * under sustained retries and every reader below clamps it.
   */
  syncUpDone: number
  syncUpTotal: number
  syncGate: SyncGate
  connected: boolean
  /** Why the daemon is not connected, when it knows. Null while it is trying. */
  connectionError: string | null
  indexerUrl: string
  domain: DomainState
  daemonReachable: boolean
  /**
   * False until the first read of the daemon and the Finder folder returns.
   * Until then `daemonReachable` and `domain` read as down and absent without
   * either being so.
   */
  shellKnown: boolean
  mountPath: string | null
  materializing: Materializing
}

/**
 * How far the OS shell has got through writing the library out. `passes` is
 * how many passes over the folders have finished since the daemon started.
 */
export type Materializing = { active: boolean; done: number; total: number; passes: number }

/** Never past the total, so a retry pass cannot read as finished or overflow. */
const syncUpDone = (s: Status): number => Math.min(s.syncUpDone, s.syncUpTotal)

/** Stops at 99: a pass that is still running has not finished, whatever it estimates. */
const percent = (fraction: number): string =>
  `${Math.min(99, Math.max(0, Math.floor(fraction * 100)))}%`

const files = (count: number): string =>
  `${count.toLocaleString()} ${count === 1 ? 'file' : 'files'}`

export const fileCountLabel = (s: Status): string => s.fileCount.toLocaleString()

export const folderCountLabel = (s: Status): string => s.folderCount.toLocaleString()

export const librarySizeLabel = (s: Status): string =>
  s.libraryBytes > 0 ? formatBytes(s.libraryBytes) : '-'

// Host only, and never an echo when that fails: a custom indexer URL can carry
// credentials and a path, and echoing is what would show them.
function indexerHost(s: Status): string | null {
  try {
    return new URL(s.indexerUrl).host || null
  } catch {
    return null
  }
}

export const indexerLabel = (s: Status): string => indexerHost(s) ?? 'Custom indexer'

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

/**
 * The one thing worth saying, chosen once.
 *
 * The headline, the value beside it, the line under it, the bar and the dot
 * all read this, so they cannot end up describing different things. Problems
 * outrank progress: a transfer running over a broken mount is still a broken
 * mount. Among progress, a file moving outranks metadata, and metadata
 * outranks the pass macOS makes over a library that already works.
 */
type Condition =
  | 'checking'
  | 'daemon-down'
  | 'disconnected'
  | 'mount-error'
  | 'mount-absent'
  | 'uploading'
  | 'queued'
  | 'syncing-down'
  | 'syncing-up'
  | 'mounting'
  | 'preparing'
  | 'ok'

// The daemon raises the gate to pending as it connects after a sign-in, before
// sync-down has fetched anything. An empty account's first pass fetches
// nothing and never sets isSyncingDown, so the gate is the only sign that
// first sync is running.
function syncingDown(s: Status): boolean {
  return s.syncingDown || s.syncGate === 'pending' || s.syncGate === 'active'
}

function condition(s: Status): Condition {
  if (!s.shellKnown) return 'checking'
  if (!s.daemonReachable) return 'daemon-down'
  if (!s.connected) return 'disconnected'
  if (s.domain === 'error') return 'mount-error'
  // The folder was there and is gone, or was never added. `unsupported` is
  // not here: a build that cannot mount has nothing wrong with it.
  if (s.domain === 'absent') return 'mount-absent'
  if (s.uploads.active > 0) return 'uploading'
  if (s.uploads.queued > 0) return 'queued'
  if (syncingDown(s)) return 'syncing-down'
  if (s.syncingUp) return 'syncing-up'
  if (s.domain === 'starting') return 'mounting'
  if (s.materializing.active) return 'preparing'
  return 'ok'
}

/** Accent means in flight, which the dot animates on, so a steady state stays quiet. */
export function indicator(s: Status): 'red' | 'orange' | 'green' | 'accent' {
  switch (condition(s)) {
    case 'daemon-down':
    case 'mount-error':
    case 'mount-absent':
      return 'red'
    // Orange is still trying. A reason means it has stopped.
    case 'disconnected':
      return s.connectionError ? 'red' : 'orange'
    case 'ok':
      return 'green'
    default:
      return 'accent'
  }
}

/** With nothing but thumbnails moving there is no file count to give, so the verb stands alone. */
const withFiles = (verb: string, count: number): string =>
  count > 0 ? `${verb} ${files(count)}` : verb

/**
 * Progress counts shard bytes already uploaded, so it is zero for as long as a
 * batch is still being packed, and the uploader holds a batch open for more
 * files before it sends it. Naming that stretch keeps it from reading as an
 * upload stuck at 0%.
 */
const inFlight = (s: Status): string =>
  withFiles(s.uploads.progress > 0 ? 'Uploading' : 'Preparing', s.uploads.activeFiles)

export function activity(s: Status): string {
  switch (condition(s)) {
    case 'checking':
      return 'Checking status'
    case 'daemon-down':
      return 'Not running'
    // A reason means the attempt is over, so it stops saying it is still trying.
    case 'disconnected':
      return s.connectionError ? 'Indexer not connected' : 'Connecting to indexer'
    case 'mount-error':
    case 'mount-absent':
      return 'Finder folder not connected'
    case 'uploading':
      return inFlight(s)
    case 'queued':
      return withFiles('Waiting to upload', s.uploads.queuedFiles)
    case 'syncing-down':
      return 'Syncing encrypted metadata'
    case 'syncing-up':
      return 'Updating encrypted metadata'
    case 'mounting':
      return 'Adding Finder folder'
    case 'preparing':
      return 'Preparing folders'
    case 'ok':
      return 'Up to date'
  }
}

/** The short value beside the headline: how far along, or how much. */
export function activityHint(s: Status): string {
  switch (condition(s)) {
    case 'uploading': {
      if (s.uploads.progress <= 0) return ''
      const size = s.uploads.activeFileBytes
      return size > 0
        ? `${percent(s.uploads.progress)} · ${formatBytes(size)}`
        : percent(s.uploads.progress)
    }
    case 'syncing-down':
      return s.syncDownProgress > 0 ? percent(s.syncDownProgress) : ''
    case 'syncing-up':
      return s.syncUpTotal > 0 ? `${syncUpDone(s)} of ${s.syncUpTotal}` : ''
    case 'preparing':
      return foldersWritten(s)
    default:
      return ''
  }
}

/**
 * The count is what the system has written out, not what it has been asked
 * for, so it only ever moves forwards.
 */
function foldersWritten(s: Status): string {
  const { done, total } = s.materializing
  return total > 0 ? `${done} of ${total}` : String(done)
}

/** A short second line, for a state that has stopped and needs its reason seen. */
export function activityDetail(s: Status): string | null {
  switch (condition(s)) {
    case 'daemon-down':
      return 'The background service has stopped'
    case 'disconnected':
      return s.connectionError
    case 'mount-error':
      return 'macOS could not add the folder'
    case 'mount-absent':
      return 'The folder is not in Finder'
    default:
      return null
  }
}

/**
 * What the status means, at the length a tooltip has room for: what is going
 * on, and for a problem, what to do about it.
 */
export function activityHelp(s: Status): string {
  const host = indexerHost(s) ?? 'the indexer'
  switch (condition(s)) {
    case 'checking':
      return 'Asking the background service and Finder how things stand.'
    case 'daemon-down':
      return "Sia Storage's background service is not answering, so nothing is syncing. Open Logs from the More menu for the reason, or quit and reopen the app."
    case 'disconnected':
      return s.connectionError
        ? `Sia Storage cannot reach ${host}, so nothing is syncing. Quit and reopen the app to try again.`
        : `Reaching ${host}.`
    case 'mount-error':
    case 'mount-absent':
      return 'The Sia Storage folder is not in Finder. Quit and reopen the app to add it again.'
    case 'uploading':
      return 'Files are packed together and encrypted on this Mac, then sent to storage providers.'
    case 'queued':
      return 'These files upload once the ones ahead of them have.'
    case 'syncing-down':
      return 'Fetching the names, folders and details of your files. They are encrypted, and only your devices can read them.'
    case 'syncing-up':
      return 'Sending changes to names, folders and details, encrypted.'
    case 'mounting':
      return 'Adding the Sia Storage folder to Finder.'
    case 'preparing':
      return 'macOS is listing your folders, so that they open without a wait.'
    case 'ok':
      return 'Nothing is waiting to upload or sync.'
  }
}

/** 0..1 for the bar, or null when the state has no measure of how far it is. */
export function activityProgress(s: Status): number | null {
  switch (condition(s)) {
    case 'uploading':
      return s.uploads.progress
    case 'syncing-down':
      return s.syncDownProgress
    case 'syncing-up':
      return s.syncUpTotal > 0 ? syncUpDone(s) / s.syncUpTotal : null
    case 'preparing':
      return s.materializing.total > 0 ? s.materializing.done / s.materializing.total : null
    default:
      return null
  }
}

/** Whether something is under way, which is what the trailing dots animate on. */
export const working = (s: Status): boolean =>
  indicator(s) === 'accent' || (condition(s) === 'disconnected' && !s.connectionError)

/**
 * How much of the library has a copy on the network. `done` is every file
 * uploaded, which is also what an empty library is.
 */
export function uploadsRow(s: Status): { done: boolean; label: string } {
  // Read at different moments, so the count waiting can briefly pass the total.
  const waiting = Math.min(s.filesNotUploaded, s.fileCount)
  if (waiting === 0) return { done: true, label: 'All files uploaded' }
  return {
    done: false,
    label: `${(s.fileCount - waiting).toLocaleString()} of ${s.fileCount.toLocaleString()}`,
  }
}

export function metadataLabel(s: Status): string {
  if (!s.daemonReachable || !s.connected) return 'Paused'
  if (syncingDown(s)) {
    return s.syncDownProgress > 0 ? `Syncing ${percent(s.syncDownProgress)}` : 'Syncing'
  }
  if (s.syncingUp) {
    return s.syncUpTotal > 0 ? `Updating ${syncUpDone(s)} of ${s.syncUpTotal}` : 'Updating'
  }
  return 'Up to date'
}

export function connectionLabel(s: Status): string {
  if (s.shellKnown && !s.daemonReachable) return 'Not running'
  if (s.connected) return 'Connected'
  return s.connectionError ? 'Not connected' : 'Connecting'
}

export type StepState = 'waiting' | 'active' | 'done' | 'failed' | 'skipped'

export type SetupStep = {
  id: 'account' | 'finder' | 'metadata' | 'folders'
  label: string
  state: StepState
  /** A count or a percentage, shown beside the label. */
  hint: string
  /** Why a step failed, shown under the label. */
  detail: string | null
  /** 0..1 while the step can say how far it is, otherwise null. */
  progress: number | null
}

function accountStep(s: Status): SetupStep {
  const host = indexerHost(s) ?? 'the indexer'
  const step = { id: 'account' as const, hint: '', detail: null, progress: null }
  if (!s.shellKnown) return { ...step, label: `Connecting to ${host}`, state: 'active' }
  if (!s.daemonReachable) {
    return {
      ...step,
      label: `Connecting to ${host}`,
      state: 'failed',
      detail: 'Sia Storage is not running. Quit and reopen the app.',
    }
  }
  if (s.connected) return { ...step, label: `Connected to ${host}`, state: 'done' }
  if (s.connectionError) {
    return { ...step, label: `Connecting to ${host}`, state: 'failed', detail: s.connectionError }
  }
  return { ...step, label: `Connecting to ${host}`, state: 'active' }
}

function finderStep(s: Status, finderName: string): SetupStep {
  const step = { id: 'finder' as const, hint: '', detail: null, progress: null }
  switch (s.domain) {
    // Nothing failed: a run from source has no signed helper to register with.
    case 'unsupported':
      return { ...step, label: 'Finder folder', state: 'skipped', hint: mountLabel(s) }
    case 'mounted':
      return { ...step, label: `Added ${finderName} to Finder`, state: 'done' }
    case 'error':
      return {
        ...step,
        label: `Adding ${finderName} to Finder`,
        state: 'failed',
        detail: 'The folder could not be registered with macOS',
      }
    default:
      return { ...step, label: `Adding ${finderName} to Finder`, state: 'active' }
  }
}

/**
 * The first sync is over once the daemon has dismissed the gate it raised at
 * sign-in. `idle` is a daemon that never raised one, which is one restarted
 * since, and there `isSyncingDown` is all there is to go on.
 */
const firstSyncOver = (s: Status): boolean =>
  s.syncGate === 'dismissed' || (s.syncGate === 'idle' && !s.syncingDown)

function metadataStep(s: Status): SetupStep {
  const step = { id: 'metadata' as const, hint: '', detail: null, progress: null }
  if (!s.daemonReachable || !s.connected) {
    return { ...step, label: 'Syncing encrypted metadata', state: 'waiting' }
  }
  if (firstSyncOver(s)) {
    return {
      ...step,
      label: 'Synced encrypted metadata',
      state: 'done',
      hint: s.fileCount > 0 ? files(s.fileCount) : 'No files yet',
    }
  }
  return {
    ...step,
    label: 'Syncing encrypted metadata',
    state: 'active',
    hint: s.syncingDown && s.syncDownProgress > 0 ? percent(s.syncDownProgress) : '',
    progress: s.syncingDown ? s.syncDownProgress : null,
  }
}

/**
 * The extension starts its pass over the folders some time after the sync that
 * brought them, and says nothing until it does, so a library with folders and
 * no finished pass is still waiting on one. The folder count cannot stand in
 * for that: a pass can finish before the system has listed a single folder.
 */
function foldersStep(s: Status, earlier: SetupStep[], overdue: boolean): SetupStep {
  const step = { id: 'folders' as const, hint: '', detail: null, progress: null }
  if (earlier.some((before) => before.state !== 'done')) {
    return { ...step, label: 'Preparing folders', state: 'waiting' }
  }
  const { active, done, total, passes } = s.materializing
  if (!active && (total === 0 || passes > 0)) {
    return { ...step, label: 'Folders ready in Finder', state: 'done' }
  }
  // The pass is a head start and nothing depends on it: a folder the system
  // has not written out is written when it is first opened. So a pass that
  // never starts ends the wait rather than leaving setup spinning on it.
  if (!active && overdue) {
    return { ...step, label: 'Folders load as you open them', state: 'skipped' }
  }
  return {
    ...step,
    label: 'Preparing folders',
    state: 'active',
    hint: active ? foldersWritten(s) : '',
    progress: active && total > 0 ? done / total : null,
  }
}

/**
 * What sign-in still has to do before the library is usable, in the order it
 * is shown. `foldersOverdue` is the caller's clock saying the folder pass has
 * had long enough to start.
 */
export function setupSteps(
  s: Status,
  finderName: string,
  opts: { foldersOverdue?: boolean } = {},
): SetupStep[] {
  const steps = [accountStep(s), finderStep(s, finderName), metadataStep(s)]
  // With no Finder folder in the build there are no folders to write out.
  if (s.domain === 'unsupported') return steps
  return [...steps, foldersStep(s, steps, opts.foldersOverdue === true)]
}

/** Whether setup is waiting on a folder pass that has not begun. */
export const awaitingFolderPass = (s: Status, steps: SetupStep[]): boolean =>
  steps.some((step) => step.id === 'folders' && step.state === 'active') && !s.materializing.active

export const setupFinished = (steps: SetupStep[]): boolean =>
  steps.every((step) => step.state === 'done' || step.state === 'skipped')

export const setupFailed = (steps: SetupStep[]): boolean =>
  steps.some((step) => step.state === 'failed')

/** Powers of 1000, which is what Finder counts in. */
export function formatBytes(bytes: number): string {
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

/** Bits per second, which is how a connection's speed is quoted. */
export function formatBitrate(bytesPerSecond: number): string {
  const units = ['bps', 'Kbps', 'Mbps', 'Gbps']
  let value = bytesPerSecond * 8
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit += 1
  }
  return `${value.toFixed(1)} ${units[unit]}`
}
