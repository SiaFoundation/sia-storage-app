import { createSubscribers } from '../../src/daemon/ipc'
import type { IpcConnection } from '@siastorage/node-adapters'

/**
 * The relay keeps a client's caches in step with the daemon's. It can stop
 * while change events keep flowing, which looks like a stale window rather
 * than a broken socket.
 */
function fakeConnection(): IpcConnection & { sent: unknown[]; close: () => void } {
  const sent: unknown[] = []
  // Every handler, not the last: the real connection accumulates them, so a
  // double that kept one would pass code that needs two to fire.
  const onClosed: Array<() => void> = []
  return {
    push: (message: unknown) => sent.push(message),
    onClose: (handler: () => void) => {
      onClosed.push(handler)
    },
    sent,
    close: () => onClosed.forEach((handler) => handler()),
  } as IpcConnection & { sent: unknown[]; close: () => void }
}

describe('the cache relay', () => {
  const message = { kind: 'cache', path: ['library'], method: 'invalidate', args: ['f1'] }

  it('reaches every subscriber', () => {
    const subscribers = createSubscribers()
    const a = fakeConnection()
    const b = fakeConnection()
    subscribers.add(a)
    subscribers.add(b)

    subscribers.broadcast(message)

    expect(a.sent).toEqual([message])
    expect(b.sent).toEqual([message])
  })

  it('stops reaching a subscriber that closed', () => {
    const subscribers = createSubscribers()
    const gone = fakeConnection()
    const staying = fakeConnection()
    subscribers.add(gone)
    subscribers.add(staying)

    gone.close()
    subscribers.broadcast(message)

    expect(gone.sent).toEqual([])
    expect(staying.sent).toEqual([message])
  })

  it('carries the value on a set, not just the key', () => {
    const subscribers = createSubscribers()
    const client = fakeConnection()
    subscribers.add(client)
    const set = { kind: 'cache', path: ['settings'], method: 'set', args: [{ tab: 'all' }, 'tab'] }

    subscribers.broadcast(set)

    expect(client.sent).toEqual([set])
  })
})
