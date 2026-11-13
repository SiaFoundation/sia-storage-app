import type { MountAdapter } from '@siastorage/core/adapters'
import type { IpcConnection } from '@siastorage/node-adapters'
import { createMountLink, mountAdapter, type MountRequestFrame } from '../../src/daemon/mountLink'

const MOUNT = { id: 'sync-root' }

/** A connection that records what the daemon pushes and can be closed from the test. */
function fakeConnection() {
  const frames: MountRequestFrame[] = []
  const closers: Array<() => void> = []
  const connection: IpcConnection = {
    push: (payload) => frames.push(payload as MountRequestFrame),
    onClose: (fn) => closers.push(fn),
  }
  return { connection, frames, close: () => closers.forEach((fn) => fn()) }
}

describe('the mount link', () => {
  it("sends a question down the link and resolves with the integration's answer", async () => {
    const link = createMountLink()
    const peer = fakeConnection()
    link.attach(peer.connection)

    const asking = link.adapter.dehydrate(MOUNT, ['a', 'b'])
    const [frame] = peer.frames
    expect(frame).toMatchObject({ event: 'mount', verb: 'dehydrate', stackIds: ['a', 'b'] })
    link.answer(frame.request, { a: 'done', b: 'refused' })

    expect(await asking).toEqual({ a: 'done', b: 'refused' })
  })

  it('has no list of changes to read', async () => {
    expect(await createMountLink().adapter.changes(MOUNT, null)).toBeNull()
  })

  it('rejects when no integration is connected', async () => {
    await expect(createMountLink().adapter.dehydrate(MOUNT, ['a'])).rejects.toThrow(
      /No integration/,
    )
  })

  it('rejects a question the integration disconnected before answering', async () => {
    const link = createMountLink()
    const peer = fakeConnection()
    link.attach(peer.connection)

    const asking = link.adapter.resend(MOUNT, ['a'])
    peer.close()

    await expect(asking).rejects.toThrow(/disconnected/)
    await expect(link.adapter.resend(MOUNT, ['a'])).rejects.toThrow(/No integration/)
  })

  it('rejects a question left unanswered past the timeout', async () => {
    const link = createMountLink({ timeoutMs: 20 })
    link.attach(fakeConnection().connection)

    await expect(link.adapter.dehydrate(MOUNT, ['a'])).rejects.toThrow(/in time/)
  })

  it('rejects a question waiting when the integration connects again, and asks the new connection', async () => {
    const link = createMountLink()
    const first = fakeConnection()
    const second = fakeConnection()
    link.attach(first.connection)
    const waiting = link.adapter.dehydrate(MOUNT, ['a'])

    link.attach(second.connection)
    first.close()

    await expect(waiting).rejects.toThrow(/reconnected/)
    const asking = link.adapter.dehydrate(MOUNT, ['a'])
    link.answer(second.frames[0].request, { a: 'done' })
    expect(await asking).toEqual({ a: 'done' })
  })

  it('sends nothing for a question already aborted', async () => {
    const link = createMountLink()
    const peer = fakeConnection()
    link.attach(peer.connection)
    const aborted = new AbortController()
    aborted.abort()

    await expect(link.adapter.dehydrate(MOUNT, ['a'], aborted.signal)).rejects.toThrow(/aborted/)
    expect(peer.frames).toEqual([])
  })
})

describe('choosing the mount adapter', () => {
  const finder: MountAdapter = {
    dehydrate: async () => ({ a: 'refused' }),
    resend: async () => ({ a: 'failed' }),
    changes: async () => ({ cursor: 'next', removed: ['a'] }),
  }

  it('reaches a mount that names a Finder agent through the agent', async () => {
    const adapter = mountAdapter(createMountLink(), finder)

    expect(await adapter.dehydrate({ id: 'domain', adapterConfig: '/agent' }, ['a'])).toEqual({
      a: 'refused',
    })
  })

  it('reaches any other mount through the link', async () => {
    const link = createMountLink()
    const peer = fakeConnection()
    link.attach(peer.connection)
    const adapter = mountAdapter(link, finder)

    const asking = adapter.dehydrate(MOUNT, ['a'])
    link.answer(peer.frames[0].request, { a: 'done' })

    expect(await asking).toEqual({ a: 'done' })
    expect(await adapter.changes(MOUNT, null)).toBeNull()
  })
})
