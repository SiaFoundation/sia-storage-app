import {
  dismissImportProgress,
  getImportProgress,
  REVEAL_DELAY_MS,
  showImportProgress,
} from './importProgress'

afterEach(() => {
  dismissImportProgress()
  jest.useRealTimers()
})

describe('importProgress store', () => {
  it('starts idle (no import, not revealed)', () => {
    const s = getImportProgress()
    expect(s.importId).toBeNull()
    expect(s.revealed).toBe(false)
  })

  it('arms an import id but stays hidden until the reveal delay elapses', () => {
    jest.useFakeTimers()
    showImportProgress('imp-1')
    let s = getImportProgress()
    expect(s.importId).toBe('imp-1')
    expect(s.revealed).toBe(false)

    jest.advanceTimersByTime(REVEAL_DELAY_MS)
    s = getImportProgress()
    expect(s.importId).toBe('imp-1')
    expect(s.revealed).toBe(true)
  })

  it('a newer import replaces the target and restarts the reveal delay', () => {
    jest.useFakeTimers()
    showImportProgress('imp-1')
    jest.advanceTimersByTime(REVEAL_DELAY_MS / 2)
    showImportProgress('imp-2')

    jest.advanceTimersByTime(REVEAL_DELAY_MS / 2)
    expect(getImportProgress().revealed).toBe(false)

    jest.advanceTimersByTime(REVEAL_DELAY_MS / 2)
    const s = getImportProgress()
    expect(s.importId).toBe('imp-2')
    expect(s.revealed).toBe(true)
  })

  it('dismiss clears the import and cancels a pending reveal', () => {
    jest.useFakeTimers()
    showImportProgress('imp-1')
    dismissImportProgress()
    expect(getImportProgress().importId).toBeNull()

    // The reveal timer must not resurrect a dismissed import.
    jest.advanceTimersByTime(REVEAL_DELAY_MS)
    const s = getImportProgress()
    expect(s.importId).toBeNull()
    expect(s.revealed).toBe(false)
  })
})
