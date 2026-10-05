import { describe, expect, it } from 'bun:test'
import type { UploadEntry } from '@siastorage/core/app'
import {
  activity,
  activityDetail,
  activityHelp,
  activityHint,
  activityProgress,
  connectionLabel,
  formatBitrate,
  indexerLabel,
  indicator,
  metadataLabel,
  mountLabel,
  NO_UPLOADS,
  type Status,
  summarizeUploads,
  type Uploads,
  uploadsRow,
  working,
} from './model'

/** A healthy, idle library. Each test changes only what it is about. */
function status(over: Partial<Status> = {}): Status {
  return {
    fileCount: 10,
    filesNotUploaded: 0,
    folderCount: 2,
    libraryBytes: 1000,
    uploads: NO_UPLOADS,
    syncingDown: false,
    syncDownProgress: 0,
    syncingUp: false,
    syncUpDone: 0,
    syncUpTotal: 0,
    syncGate: 'idle',
    connected: true,
    connectionError: null,
    indexerUrl: 'https://sia.storage',
    domain: 'mounted',
    daemonReachable: true,
    shellKnown: true,
    mountPath: '/mount',
    materializing: { active: false, done: 0, total: 0, passes: 0 },
    ...over,
  }
}

const uploads = (over: Partial<Uploads>): Uploads => ({ ...NO_UPLOADS, ...over })

const entry = (over: Partial<UploadEntry>): UploadEntry => ({
  id: 'f',
  kind: 'file',
  size: 100,
  progress: 0,
  status: 'uploading',
  ...over,
})

describe('what the status line says', () => {
  it('says the library is up to date when nothing is happening', () => {
    expect(activity(status())).toBe('Up to date')
    expect(activityHint(status())).toBe('')
    expect(activityDetail(status())).toBeNull()
    expect(activityProgress(status())).toBeNull()
    expect(indicator(status())).toBe('green')
    expect(working(status())).toBe(false)
  })

  it('names the files being uploaded, how far along and how big', () => {
    const s = status({
      uploads: uploads({
        active: 3,
        activeFiles: 2,
        activeFileBytes: 1_900_000_000,
        progress: 0.62,
      }),
    })

    expect(activity(s)).toBe('Uploading 2 files')
    expect(activityHint(s)).toBe('62% · 1.9 GB')
    expect(activityProgress(s)).toBe(0.62)
    expect(indicator(s)).toBe('accent')
    expect(working(s)).toBe(true)
  })

  // The uploader holds a batch open for more files before it sends anything,
  // and that wait is not an upload at 0%.
  it('says preparing until the first bytes have gone', () => {
    const s = status({ uploads: uploads({ active: 1, activeFiles: 1, activeFileBytes: 500 }) })

    expect(activity(s)).toBe('Preparing 1 file')
    expect(activityHint(s)).toBe('')
  })

  it('gives no file count while only thumbnails are uploading', () => {
    const s = status({ uploads: uploads({ active: 2, progress: 0.5 }) })

    expect(activity(s)).toBe('Uploading')
    expect(activityHint(s)).toBe('50%')
  })

  it('says files are waiting when none has been picked up yet', () => {
    const s = status({ uploads: uploads({ queued: 4, queuedFiles: 4 }) })

    expect(activity(s)).toBe('Waiting to upload 4 files')
    expect(activityProgress(s)).toBeNull()
  })

  it('calls a sync-down a metadata sync, not a download', () => {
    const s = status({ syncingDown: true, syncDownProgress: 0.42 })

    expect(activity(s)).toBe('Syncing encrypted metadata')
    expect(activityHint(s)).toBe('42%')
    expect(activityProgress(s)).toBe(0.42)
  })

  it('calls a sync-up a metadata update, not an upload', () => {
    const s = status({ syncingUp: true, syncUpDone: 12, syncUpTotal: 40 })

    expect(activity(s)).toBe('Updating encrypted metadata')
    expect(activityHint(s)).toBe('12 of 40')
    expect(activityProgress(s)).toBe(0.3)
  })

  it('never shows a sync that is still running as 100%', () => {
    expect(activityHint(status({ syncingDown: true, syncDownProgress: 1 }))).toBe('99%')
  })

  it('counts the folders macOS has read while it is reading them', () => {
    const s = status({ materializing: { active: true, done: 3, total: 20, passes: 0 } })

    expect(activity(s)).toBe('Preparing folders')
    expect(activityHint(s)).toBe('3 of 20')
    expect(indicator(s)).toBe('accent')
  })

  it('drops the folder total when the library reports none', () => {
    const s = status({ materializing: { active: true, done: 3, total: 0, passes: 0 } })

    expect(activityHint(s)).toBe('3')
    expect(activityProgress(s)).toBeNull()
  })

  it('says nothing about preparing once it has stopped', () => {
    const s = status({ materializing: { active: false, done: 20, total: 20, passes: 1 } })

    expect(activity(s)).toBe('Up to date')
  })

  it('keeps trying in orange and gives up in red', () => {
    const trying = status({ connected: false })
    const stopped = status({ connected: false, connectionError: 'Could not reach sia.storage' })

    expect(activity(trying)).toBe('Connecting to indexer')
    expect(activityDetail(trying)).toBeNull()
    expect(indicator(trying)).toBe('orange')
    expect(working(trying)).toBe(true)

    expect(activity(stopped)).toBe('Indexer not connected')
    expect(activityDetail(stopped)).toBe('Could not reach sia.storage')
    expect(indicator(stopped)).toBe('red')
    expect(working(stopped)).toBe(false)
  })
})

/*
 * The headline, the value beside it, the bar and the dot all read one
 * decision, so they cannot describe different things at once.
 */
describe('what the status line says when pointed at', () => {
  it('names the host it cannot reach and what to do', () => {
    const s = status({ connected: false, connectionError: 'Could not reach sia.storage' })

    expect(activityHelp(s)).toBe(
      'Sia Storage cannot reach sia.storage, so nothing is syncing. Quit and reopen the app to try again.',
    )
  })

  it('never echoes an indexer URL it could not parse', () => {
    const s = status({ connected: false, connectionError: 'no', indexerUrl: 'user:pw@nowhere' })

    expect(activityHelp(s)).toContain('cannot reach the indexer,')
    expect(activityHelp(s)).not.toContain('pw')
  })

  it('has something to say for a library with nothing wrong', () => {
    expect(activityHelp(status())).toBe('Nothing is waiting to upload or sync.')
  })
})

describe('which state the status line picks when several hold', () => {
  it('reports an upload ahead of a metadata sync', () => {
    const s = status({
      uploads: uploads({ active: 1, activeFiles: 1, progress: 0.5 }),
      syncingDown: true,
    })

    expect(activity(s)).toBe('Uploading 1 file')
  })

  it('reports a sync-down ahead of a sync-up', () => {
    const s = status({ syncingDown: true, syncingUp: true, syncUpTotal: 4 })

    expect(activity(s)).toBe('Syncing encrypted metadata')
  })

  it('reports a metadata sync ahead of the folders being read', () => {
    const s = status({
      syncingUp: true,
      syncUpTotal: 2,
      materializing: { active: true, done: 3, total: 20, passes: 0 },
    })

    expect(activity(s)).toBe('Updating encrypted metadata')
  })

  it('reports a broken mount ahead of an upload', () => {
    const s = status({ domain: 'error', uploads: uploads({ active: 1, activeFiles: 1 }) })

    expect(activity(s)).toBe('Finder folder not connected')
    expect(activityDetail(s)).toBe('macOS could not add the folder')
    expect(indicator(s)).toBe('red')
  })

  it('reports a Finder folder that is gone, and one still being added', () => {
    const gone = status({ domain: 'absent' })
    const adding = status({ domain: 'starting' })

    expect(activity(gone)).toBe('Finder folder not connected')
    expect(activityDetail(gone)).toBe('The folder is not in Finder')
    expect(indicator(gone)).toBe('red')
    expect(working(gone)).toBe(false)

    expect(activity(adding)).toBe('Adding Finder folder')
    expect(indicator(adding)).toBe('accent')
    expect(working(adding)).toBe(true)
  })

  it('finds nothing wrong with a build that has no Finder folder', () => {
    expect(activity(status({ domain: 'unsupported' }))).toBe('Up to date')
  })

  it('reports a missing daemon ahead of everything else', () => {
    const s = status({
      daemonReachable: false,
      connected: false,
      domain: 'error',
      materializing: { active: true, done: 3, total: 20, passes: 0 },
    })

    expect(activity(s)).toBe('Not running')
  })

  it('reports neither a stopped daemon nor a missing folder before the first read of them returns', () => {
    const s = status({ shellKnown: false, daemonReachable: false, domain: 'absent' })

    expect(activity(s)).toBe('Checking status')
    expect(activityDetail(s)).toBeNull()
    expect(indicator(s)).toBe('accent')
    expect(connectionLabel(s)).toBe('Connected')
  })
})

/*
 * `syncUpDone` counts objects attempted, not rows cleared, so a failed object
 * is counted again on the next pass and the count passes the total.
 */
describe('a sync-up whose retries pass the total', () => {
  const retrying = status({ syncingUp: true, syncUpTotal: 10, syncUpDone: 12 })

  it('still reads as updating', () => {
    expect(activity(retrying)).toBe('Updating encrypted metadata')
    expect(indicator(retrying)).toBe('accent')
  })

  it('never shows more done than there are', () => {
    expect(activityHint(retrying)).toBe('10 of 10')
    expect(metadataLabel(retrying)).toBe('Updating 10 of 10')
  })

  it('never fills the bar past full', () => {
    expect(activityProgress(retrying)).toBe(1)
  })
})

describe('the uploads the daemon holds, summed', () => {
  it('counts files and thumbnails in flight but only files by name', () => {
    const summary = summarizeUploads([
      entry({ id: 'a', size: 300, progress: 1 }),
      entry({ id: 'b', size: 100, progress: 0, status: 'packing' }),
      entry({ id: 't', kind: 'thumb', size: 100, progress: 0, status: 'packed' }),
    ])

    expect(summary.active).toBe(3)
    expect(summary.activeFiles).toBe(2)
    expect(summary.activeFileBytes).toBe(400)
    expect(summary.progress).toBe(0.6)
  })

  it('keeps queued entries apart from the ones in flight', () => {
    const summary = summarizeUploads([
      entry({ id: 'a', status: 'queued' }),
      entry({ id: 't', kind: 'thumb', status: 'queued' }),
    ])

    expect(summary).toEqual({ ...NO_UPLOADS, queued: 2, queuedFiles: 1 })
  })

  it('leaves out uploads that finished or failed', () => {
    const summary = summarizeUploads([
      entry({ id: 'a', status: 'done', progress: 1 }),
      entry({ id: 'b', status: 'error' }),
    ])

    expect(summary).toEqual(NO_UPLOADS)
  })
})

describe('the rows the window adds', () => {
  it('marks the library uploaded when no file is waiting, and counts when some are', () => {
    expect(uploadsRow(status())).toEqual({ done: true, label: 'All files uploaded' })
    expect(uploadsRow(status({ fileCount: 5, filesNotUploaded: 1 }))).toEqual({
      done: false,
      label: '4 of 5',
    })
  })

  it('counts an empty library as uploaded', () => {
    expect(uploadsRow(status({ fileCount: 0 })).done).toBe(true)
  })

  // The two counts are read separately, so one can be a moment ahead.
  it('never counts more files waiting than there are', () => {
    expect(uploadsRow(status({ fileCount: 2, filesNotUploaded: 3 })).label).toBe('0 of 2')
  })

  it('says where metadata sync stands', () => {
    expect(metadataLabel(status())).toBe('Up to date')
    expect(metadataLabel(status({ syncingDown: true, syncDownProgress: 0.4 }))).toBe('Syncing 40%')
    expect(metadataLabel(status({ connected: false }))).toBe('Paused')
  })

  it('counts the first sync as syncing before it has fetched anything', () => {
    for (const syncGate of ['pending', 'active'] as const) {
      const s = status({ syncGate, syncingDown: false })
      expect(activity(s)).toBe('Syncing encrypted metadata')
      expect(metadataLabel(s)).toBe('Syncing')
    }
    expect(activity(status({ syncGate: 'idle' }))).toBe('Up to date')
  })

  it('says whether the indexer is reached', () => {
    expect(connectionLabel(status())).toBe('Connected')
    expect(connectionLabel(status({ connected: false }))).toBe('Connecting')
    expect(connectionLabel(status({ connected: false, connectionError: 'no' }))).toBe(
      'Not connected',
    )
    expect(connectionLabel(status({ daemonReachable: false }))).toBe('Not running')
  })

  it('quotes a speed in bits, not bytes', () => {
    expect(formatBitrate(125_000)).toBe('1.0 Mbps')
  })

  it('calls the mount out as absent from this build when it cannot mount', () => {
    expect(mountLabel(status({ domain: 'unsupported' }))).toBe('Not in this build')
  })
})

describe('the indexer the tray names', () => {
  it('shows the host and drops the path', () => {
    expect(indexerLabel(status({ indexerUrl: 'https://sia.storage/v1/api' }))).toBe('sia.storage')
  })

  it('drops a username and password rather than rendering them', () => {
    expect(indexerLabel(status({ indexerUrl: 'https://user:pw@sia.storage' }))).toBe('sia.storage')
  })

  it('names a URL that will not parse instead of echoing it', () => {
    expect(indexerLabel(status({ indexerUrl: 'nowhere' }))).toBe('Custom indexer')
  })

  // `new URL` accepts this, reading `user:` as the scheme, and leaves the host
  // empty. Echoing the input on an empty host would put the password on screen.
  it('names a URL that parses to no host instead of echoing it', () => {
    expect(indexerLabel(status({ indexerUrl: 'user:pw@nowhere' }))).toBe('Custom indexer')
  })
})
