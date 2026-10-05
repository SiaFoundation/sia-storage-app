import { describe, expect, it } from 'bun:test'
import type { IpcMessage } from '@siastorage/core/app'
import { paceLibraryClears } from './cacheMessages'

const clearLibrary: IpcMessage = {
  kind: 'cache',
  path: ['library'],
  method: 'invalidateAll',
  args: [],
}
const clearSync: IpcMessage = { kind: 'cache', path: ['sync'], method: 'invalidateAll', args: [] }

describe('library cache clears from the daemon', () => {
  it('applies the first of a burst of library clears at once and one more when the window closes', async () => {
    const applied: IpcMessage[] = []
    const receive = paceLibraryClears((message) => applied.push(message), 50)

    for (let i = 0; i < 10; i++) receive(clearLibrary)
    expect(applied).toHaveLength(1)

    await Bun.sleep(80)
    expect(applied).toHaveLength(2)
  })

  it('applies every other message as it arrives', () => {
    const applied: IpcMessage[] = []
    const receive = paceLibraryClears((message) => applied.push(message), 50)

    receive(clearLibrary)
    for (let i = 0; i < 3; i++) receive(clearSync)

    expect(applied).toEqual([clearLibrary, clearSync, clearSync, clearSync])
  })
})
