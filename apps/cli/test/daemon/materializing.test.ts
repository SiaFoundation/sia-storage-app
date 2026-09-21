import { createMaterializing } from '../../src/daemon/materializing'

describe('materializing', () => {
  it('reports nothing in progress before a pass starts', () => {
    expect(createMaterializing().state()).toEqual({ active: false, done: 0 })
  })

  it('counts each folder the system reads during a pass', () => {
    const m = createMaterializing()
    m.report('start')

    m.observe('ds:provider:list', ['dir:a'])
    m.observe('ds:provider:list', ['dir:b'])

    expect(m.state()).toEqual({ active: true, done: 2 })
  })

  it('counts a folder read twice only once', () => {
    const m = createMaterializing()
    m.report('start')

    m.observe('ds:provider:list', ['dir:a'])
    m.observe('ds:provider:list', ['dir:a'])

    expect(m.state().done).toBe(1)
  })

  it('ignores containers that are not folders', () => {
    const m = createMaterializing()
    m.report('start')

    m.observe('ds:provider:list', [null])
    m.observe('ds:provider:list', ['workingset'])
    m.observe('ds:provider:list', ['NSFileProviderTrashContainerItemIdentifier'])

    expect(m.state()).toEqual({ active: true, done: 0 })
  })

  it('reports finished once the shell says the system settled', () => {
    const m = createMaterializing()
    m.report('start')
    m.observe('ds:provider:list', ['dir:a'])

    m.report('settled')

    expect(m.state()).toEqual({ active: false, done: 1 })
  })

  it('leaves the tray idle for a folder the user opens after the pass', () => {
    const m = createMaterializing()
    m.report('start')
    m.observe('ds:provider:list', ['dir:a'])
    m.report('settled')

    m.observe('ds:provider:list', ['dir:b'])

    expect(m.state()).toEqual({ active: false, done: 1 })
  })

  it('starts the count over on the next pass', () => {
    const m = createMaterializing()
    m.report('start')
    m.observe('ds:provider:list', ['dir:a'])
    m.report('settled')

    m.report('start')

    expect(m.state()).toEqual({ active: true, done: 0 })
  })

  it('ends a pass the shell can no longer finish when the socket drops', () => {
    const m = createMaterializing()
    m.report('start')
    m.observe('ds:provider:list', ['dir:a'])

    m.disconnected()

    expect(m.state()).toEqual({ active: false, done: 1 })
  })
})
