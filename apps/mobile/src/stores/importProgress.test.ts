import {
  beginImportProgress,
  dismissImportProgress,
  failImportProgress,
  finishImportProgress,
  getImportProgress,
  reportImportProgress,
  revealImportProgress,
  SUCCESS_FLASH_MS,
} from './importProgress'

afterEach(() => {
  dismissImportProgress()
  jest.useRealTimers()
})

describe('importProgress store', () => {
  it('begins in pending phase with totals primed and counters at zero', () => {
    beginImportProgress(5, 1_000)
    const s = getImportProgress()
    expect(s.phase).toBe('pending')
    expect(s.totalFiles).toBe(5)
    expect(s.totalBytes).toBe(1_000)
    expect(s.copiedFiles).toBe(0)
    expect(s.copiedBytes).toBe(0)
  })

  it('reveal transitions pending -> running', () => {
    beginImportProgress(2, 100)
    revealImportProgress()
    expect(getImportProgress().phase).toBe('running')
  })

  it('reportProgress increments counters', () => {
    beginImportProgress(2, 100)
    revealImportProgress()
    reportImportProgress(30)
    reportImportProgress(70)
    const s = getImportProgress()
    expect(s.copiedFiles).toBe(2)
    expect(s.copiedBytes).toBe(100)
  })

  it('finish from pending phase resets to idle without showing the modal', () => {
    beginImportProgress(2, 100)
    finishImportProgress()
    expect(getImportProgress().phase).toBe('idle')
  })

  it('finish from running phase moves to complete then auto-dismisses to idle', () => {
    jest.useFakeTimers()
    beginImportProgress(2, 100)
    revealImportProgress()
    finishImportProgress()
    expect(getImportProgress().phase).toBe('complete')

    jest.advanceTimersByTime(SUCCESS_FLASH_MS)
    expect(getImportProgress().phase).toBe('idle')
  })

  it('fail transitions to error and sticks until dismissed', () => {
    jest.useFakeTimers()
    beginImportProgress(2, 100)
    revealImportProgress()
    failImportProgress('disk full')
    expect(getImportProgress().phase).toBe('error')
    expect(getImportProgress().errorMessage).toBe('disk full')

    jest.advanceTimersByTime(60_000)
    expect(getImportProgress().phase).toBe('error')

    dismissImportProgress()
    expect(getImportProgress().phase).toBe('idle')
  })

  it('beginning a new import while complete is pending resets cleanly', () => {
    jest.useFakeTimers()
    beginImportProgress(1, 10)
    revealImportProgress()
    finishImportProgress()
    expect(getImportProgress().phase).toBe('complete')

    beginImportProgress(3, 30)
    expect(getImportProgress().phase).toBe('pending')
    expect(getImportProgress().totalFiles).toBe(3)

    jest.advanceTimersByTime(SUCCESS_FLASH_MS)
    expect(getImportProgress().phase).toBe('pending')
    expect(getImportProgress().totalFiles).toBe(3)
  })

  it('concurrent begin aggregates totals into the running modal', () => {
    jest.useFakeTimers()
    beginImportProgress(2, 100)
    revealImportProgress()
    reportImportProgress(40)
    beginImportProgress(3, 250)

    const s = getImportProgress()
    expect(s.phase).toBe('running')
    expect(s.totalFiles).toBe(5)
    expect(s.totalBytes).toBe(350)
    expect(s.copiedFiles).toBe(1)
    expect(s.copiedBytes).toBe(40)
  })

  it('holds at running until every in-flight import finishes', () => {
    jest.useFakeTimers()
    beginImportProgress(2, 100)
    revealImportProgress()
    beginImportProgress(3, 200)

    finishImportProgress()
    expect(getImportProgress().phase).toBe('running')

    finishImportProgress()
    expect(getImportProgress().phase).toBe('complete')

    jest.advanceTimersByTime(SUCCESS_FLASH_MS)
    expect(getImportProgress().phase).toBe('idle')
  })

  it('fail collapses in-flight imports; later finishes are no-ops', () => {
    jest.useFakeTimers()
    beginImportProgress(2, 100)
    revealImportProgress()
    beginImportProgress(3, 200)

    failImportProgress('disk full')
    expect(getImportProgress().phase).toBe('error')

    finishImportProgress()
    finishImportProgress()
    expect(getImportProgress().phase).toBe('error')
    expect(getImportProgress().errorMessage).toBe('disk full')
  })

  it('finish from idle or error is a no-op', () => {
    jest.useFakeTimers()
    finishImportProgress()
    expect(getImportProgress().phase).toBe('idle')

    beginImportProgress(1, 10)
    revealImportProgress()
    failImportProgress('boom')
    finishImportProgress()
    expect(getImportProgress().phase).toBe('error')
    expect(getImportProgress().errorMessage).toBe('boom')
  })
})
