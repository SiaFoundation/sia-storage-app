import {
  getImportPacing,
  type ImportPacingState,
  PACING_STALE_MS,
  publishImportPacing,
  resetImportPacing,
} from './importPacing'

function tick(cause: ImportPacingState['cause'], at = 1_000): ImportPacingState {
  return { at, cause, freeBytes: 5, pendingLocalBytes: 7, deferred: 3 }
}

afterEach(() => resetImportPacing())

describe('importPacing cause damping', () => {
  it('has no snapshot before the first publish', () => {
    expect(getImportPacing(1_000)).toBeNull()
  })

  it('a cause appears only after two consecutive ticks', () => {
    publishImportPacing(tick('backlog'))
    expect(getImportPacing(1_000)?.cause).toBeNull()
    publishImportPacing(tick('backlog'))
    expect(getImportPacing(1_000)?.cause).toBe('backlog')
  })

  it('a one-tick flap never publishes', () => {
    publishImportPacing(tick('backlog'))
    publishImportPacing(tick(null))
    publishImportPacing(tick('backlog'))
    expect(getImportPacing(1_000)?.cause).toBeNull()
  })

  it('a published cause clears only after two consecutive quiet ticks', () => {
    publishImportPacing(tick('headroom'))
    publishImportPacing(tick('headroom'))
    publishImportPacing(tick(null))
    expect(getImportPacing(1_000)?.cause).toBe('headroom')
    publishImportPacing(tick(null))
    expect(getImportPacing(1_000)?.cause).toBeNull()
  })

  it('a switch between two pressure causes swaps immediately', () => {
    publishImportPacing(tick('headroom'))
    publishImportPacing(tick('headroom'))
    publishImportPacing(tick('backlog'))
    expect(getImportPacing(1_000)?.cause).toBe('backlog')
  })

  it('byte fields pass through while the cause is still damping', () => {
    publishImportPacing(tick('backlog'))
    const snap = getImportPacing(1_000)
    expect(snap?.cause).toBeNull()
    expect(snap?.freeBytes).toBe(5)
    expect(snap?.pendingLocalBytes).toBe(7)
    expect(snap?.deferred).toBe(3)
  })

  it('a snapshot past the staleness window reads as absent', () => {
    publishImportPacing(tick('backlog'))
    expect(getImportPacing(1_000 + PACING_STALE_MS)).not.toBeNull()
    expect(getImportPacing(1_000 + PACING_STALE_MS + 1)).toBeNull()
  })
})
