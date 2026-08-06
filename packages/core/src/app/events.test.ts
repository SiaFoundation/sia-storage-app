import type { ChangeScope } from '../types/changes'
import { coalesceChanges, createAppEvents, type ChangeSource } from './events'

function collect(source: ChangeSource) {
  const seen: ChangeScope[] = []
  source.on((scope) => seen.push(scope))
  return seen
}

describe('createAppEvents', () => {
  it('delivers synchronously to every listener', () => {
    const events = createAppEvents()
    const a = collect(events)
    const b = collect(events)

    events.emit('sync')

    expect(a).toEqual(['sync'])
    expect(b).toEqual(['sync'])
  })

  it('stops delivering after unsubscribe', () => {
    const events = createAppEvents()
    const seen: ChangeScope[] = []
    const off = events.on((scope) => seen.push(scope))

    events.emit('library')
    off()
    events.emit('library')

    expect(seen).toEqual(['library'])
  })

  it('keeps delivering to the other listeners when one throws', () => {
    const events = createAppEvents()
    events.on(() => {
      throw new Error('subscriber went away')
    })
    const seen = collect(events)

    events.emit('library')

    expect(seen).toEqual(['library'])
  })

  it('delivers to nobody after dispose', () => {
    const events = createAppEvents()
    const seen = collect(events)

    events.dispose()
    events.emit('library')

    expect(seen).toEqual([])
  })
})

describe('coalesceChanges', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('delivers a lone change at once', () => {
    const events = createAppEvents()
    const seen = collect(coalesceChanges(events, 200))

    events.emit('library')

    expect(seen).toEqual(['library'])
  })

  it('delivers a burst as the leading signal and one trailing signal', () => {
    const events = createAppEvents()
    const seen = collect(coalesceChanges(events, 200))

    for (let i = 0; i < 50; i++) events.emit('library')
    expect(seen).toEqual(['library'])
    jest.advanceTimersByTime(200)

    expect(seen).toEqual(['library', 'library'])
  })

  it('delivers again for a burst after the window closes', () => {
    const events = createAppEvents()
    const seen = collect(coalesceChanges(events, 200))

    events.emit('library')
    jest.advanceTimersByTime(200)
    events.emit('library')
    jest.advanceTimersByTime(200)

    expect(seen).toEqual(['library', 'library'])
  })

  it('keeps delivering once per window through a sustained stream', () => {
    const events = createAppEvents()
    const seen = collect(coalesceChanges(events, 200))

    for (let i = 0; i < 5; i++) {
      events.emit('library')
      jest.advanceTimersByTime(150)
    }
    expect(seen).toHaveLength(4)

    jest.advanceTimersByTime(200)
    expect(seen).toHaveLength(5)
  })

  it('does not let a library burst hold back a connection change', () => {
    const events = createAppEvents()
    const seen = collect(coalesceChanges(events, 200))

    for (let i = 0; i < 5; i++) events.emit('library')
    events.emit('connection')

    expect(seen).toContain('connection')
  })

  it('drops the trailing delivery on dispose', () => {
    const events = createAppEvents()
    const coalesced = coalesceChanges(events, 200)
    const seen = collect(coalesced)

    events.emit('library')
    events.emit('library')
    coalesced.dispose()
    jest.advanceTimersByTime(200)

    expect(seen).toEqual(['library'])
  })
})
