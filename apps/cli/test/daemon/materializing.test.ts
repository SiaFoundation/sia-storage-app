import { createMaterializing } from '../../src/daemon/materializing'

describe('materializing', () => {
  let clock = 1_000
  const at = (ms: number) => {
    clock = ms
  }
  const tracker = () => createMaterializing(() => clock)

  beforeEach(() => {
    clock = 1_000
  })

  it('counts each folder the system reads', () => {
    const m = tracker()

    m.observe('ds:provider:list', ['dir:a'])
    m.observe('ds:provider:list', ['dir:b'])

    expect(m.state()).toEqual({ active: true, done: 2 })
  })

  it('counts a folder read twice only once', () => {
    const m = tracker()

    m.observe('ds:provider:list', ['dir:a'])
    m.observe('ds:provider:list', ['dir:a'])

    expect(m.state().done).toBe(1)
  })

  it('ignores containers that are not folders', () => {
    const m = tracker()

    m.observe('ds:provider:list', [null])
    m.observe('ds:provider:list', ['workingset'])
    m.observe('ds:provider:list', ['NSFileProviderTrashContainerItemIdentifier'])

    expect(m.state()).toEqual({ active: false, done: 0 })
  })

  it('reports nothing in progress before any folder is read', () => {
    expect(tracker().state()).toEqual({ active: false, done: 0 })
  })

  it('stops reporting progress once the reads go quiet', () => {
    const m = tracker()
    m.observe('ds:provider:list', ['dir:a'])

    at(1_000 + 8_000)

    expect(m.state()).toEqual({ active: false, done: 1 })
  })

  it('starts over when the extension reconnects', () => {
    const m = tracker()
    m.observe('ds:provider:list', ['dir:a'])

    // A fresh extension means the system's copy is being rebuilt from nothing.
    m.observe('hello', ['0.0.1'])

    expect(m.state()).toEqual({ active: false, done: 0 })
  })
})
