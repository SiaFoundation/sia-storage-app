import { describe, expect, it } from 'bun:test'
import {
  activity,
  activityDetail,
  indexerLabel,
  indicator,
  mountLabel,
  transferCount,
  transferProgress,
  type Status,
} from './model'

/** A healthy, idle library. Each test changes only what it is about. */
function status(over: Partial<Status> = {}): Status {
  return {
    fileCount: 10,
    libraryBytes: 1000,
    uploadsDone: 0,
    uploadsTotal: 0,
    uploadsPending: 0,
    syncingDown: false,
    downloadProgress: 0,
    connected: true,
    connectionError: null,
    indexerUrl: 'https://sia.storage',
    domain: 'mounted',
    daemonReachable: true,
    mountPath: '/mount',
    ...over,
  }
}

describe('what the popover says', () => {
  it('says the library is up to date when nothing is happening', () => {
    expect(activity(status())).toBe('Up to date')
    expect(activityDetail(status())).toBeNull()
    expect(indicator(status())).toBe('green')
  })

  /*
   * The headline, the line under it and the dot all read the same decision, so
   * they cannot describe different problems at once. These pin the order.
   */
  it('reports an upload ahead of a steady library', () => {
    const s = status({ uploadsTotal: 2, uploadsDone: 1 })

    expect(activity(s)).toBe('Uploading')
  })

  it('reports a broken mount ahead of a transfer', () => {
    const s = status({ domain: 'error', uploadsTotal: 2, uploadsDone: 1 })

    expect(activity(s)).toBe('Finder folder unavailable')
    expect(indicator(s)).toBe('red')
  })

  it('reports a missing daemon ahead of everything else', () => {
    const s = status({ daemonReachable: false, connected: false, domain: 'error' })

    expect(activity(s)).toBe('Not running')
  })

  it('calls the mount out as absent from this build when it cannot mount', () => {
    expect(mountLabel(status({ domain: 'unsupported' }))).toBe('Not in this build')
  })
})

/*
 * `uploadsDone` counts objects attempted, not rows cleared, so a failed object
 * is counted again on the next pass and the count passes the total.
 */
describe('an upload run whose retries pass the total', () => {
  const retrying = status({ uploadsTotal: 10, uploadsDone: 12 })

  it('still reads as uploading', () => {
    expect(activity(retrying)).toBe('Uploading')
    expect(indicator(retrying)).toBe('accent')
  })

  it('never shows more done than there are', () => {
    expect(transferCount(retrying)).toBe('10 of 10')
  })

  it('never fills the bar past full', () => {
    expect(transferProgress(retrying)).toBe(1)
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
