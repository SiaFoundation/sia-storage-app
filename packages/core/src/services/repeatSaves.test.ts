import { REPEAT_SAVE_MAX_HOLD, REPEAT_SAVE_QUIET } from '../config'
import { RepeatSaveHold } from './repeatSaves'

describe('RepeatSaveHold', () => {
  let released: string[]
  let hold: RepeatSaveHold

  beforeEach(() => {
    jest.useFakeTimers()
    released = []
    hold = new RepeatSaveHold((id) => released.push(id))
  })

  afterEach(() => {
    hold.clear()
    jest.useRealTimers()
  })

  /** Saves `stackId` as `versionId` at the fake clock's time. */
  const save = (stackId: string, versionId: string) => hold.save(stackId, versionId, Date.now())

  it('does not hold a single save', () => {
    expect(save('notes', 'v1')).toBe(false)
    expect(hold.heldIds()).toEqual([])
  })

  it('does not hold a save made the quiet period or more after the previous one', () => {
    save('notes', 'v1')
    jest.advanceTimersByTime(REPEAT_SAVE_QUIET)

    expect(save('notes', 'v2')).toBe(false)
  })

  it('holds a save made within the quiet period of the previous one, and releases it after a quiet period', () => {
    save('notes', 'v1')
    jest.advanceTimersByTime(REPEAT_SAVE_QUIET - 1)

    expect(save('notes', 'v2')).toBe(true)
    expect(hold.heldIds()).toEqual(['v2'])
    jest.advanceTimersByTime(REPEAT_SAVE_QUIET - 1)
    expect(released).toEqual([])
    jest.advanceTimersByTime(1)
    expect(released).toEqual(['v2'])
    expect(hold.heldIds()).toEqual([])
  })

  it('replaces a held save with a newer one, which alone is released', () => {
    save('notes', 'v1')
    save('notes', 'v2')
    jest.advanceTimersByTime(REPEAT_SAVE_QUIET / 2)
    expect(save('notes', 'v3')).toBe(true)

    jest.advanceTimersByTime(REPEAT_SAVE_QUIET)
    expect(released).toEqual(['v3'])
  })

  /** Saves every REPEAT_SAVE_QUIET / 3 until a save is released. Returns the time of the first held save. */
  function saveNonstopUntilReleased(stackId: string): number {
    save(stackId, `${stackId}-0`)
    jest.advanceTimersByTime(REPEAT_SAVE_QUIET / 3)
    const firstHeldAt = Date.now()
    let n = 0
    const before = released.length
    while (released.length === before) {
      save(stackId, `${stackId}-${++n}`)
      jest.advanceTimersByTime(REPEAT_SAVE_QUIET / 3)
    }
    return firstHeldAt
  }

  it('releases a file saved nonstop at the cap after the first held save', () => {
    const releasedAt: number[] = []
    hold = new RepeatSaveHold((id) => {
      released.push(id)
      releasedAt.push(Date.now())
    })

    const firstHeldAt = saveNonstopUntilReleased('notes')

    expect(releasedAt).toEqual([firstHeldAt + REPEAT_SAVE_MAX_HOLD])
    expect(hold.heldIds()).toEqual([])
  })

  it('starts a new run after the cap releases, and holds the next quick save', () => {
    saveNonstopUntilReleased('notes')

    expect(save('notes', 'next')).toBe(true)
    jest.advanceTimersByTime(REPEAT_SAVE_QUIET)
    expect(released.at(-1)).toBe('next')
  })

  it('keeps each file to its own run', () => {
    save('a', 'a1')
    expect(save('b', 'b1')).toBe(false)
    expect(save('a', 'a2')).toBe(true)
    expect(hold.heldIds()).toEqual(['a2'])
  })

  it('releases a held save at once when asked by version or by file', () => {
    save('a', 'a1')
    save('a', 'a2')
    save('b', 'b1')
    save('b', 'b2')

    hold.releaseNow(['a2'])
    hold.releaseNow(['b'])
    expect(released).toEqual(['a2', 'b2'])
    jest.advanceTimersByTime(REPEAT_SAVE_MAX_HOLD)
    expect(released).toEqual(['a2', 'b2'])
  })

  it('stops holding a dropped save without releasing it', () => {
    save('notes', 'v1')
    save('notes', 'v2')

    expect(hold.drop('v2')).toBe(true)
    jest.advanceTimersByTime(REPEAT_SAVE_MAX_HOLD)
    expect(released).toEqual([])
    expect(hold.heldIds()).toEqual([])
  })

  it('forgets every hold on clear, releasing nothing and leaving no timer', () => {
    save('notes', 'v1')
    save('notes', 'v2')

    hold.clear()
    expect(jest.getTimerCount()).toBe(0)
    expect(save('notes', 'v3')).toBe(false)
  })
})
