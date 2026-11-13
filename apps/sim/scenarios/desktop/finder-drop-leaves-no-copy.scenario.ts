import { sha256 } from '../../src/integrity'
import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: "when the system drops Finder's copy of a file on its own, nothing of the file is left on the Mac",
  description:
    "A file saved in Finder uploads, and the Mac's daemon then removes its cache copy, since Finder holds the file. With the cache far under its limit, the system evicts Finder's copy the way Remove Download does. The daemon reads which file left Finder and forgets it, with no copy of its own to remove, and the bytes it counts on this Mac fall to 0. Finder then opens the file again from the network with the same bytes, and the daemon removes its cache copy again once it reads that Finder holds the file.",
  devices: { mac: 'desktop' },
  timeoutMs: 6 * 60_000,
  async run({ devices, step, precondition, check, checkEqual, waitFor }) {
    const { mac } = devices
    const bytes = crypto.getRandomValues(new Uint8Array(256 * 1024))
    await step('a file is saved in Finder', () => mac.finderWrite('dropped.bin', bytes))
    const file = await waitFor(
      'the file to upload',
      async () => (await mac.library()).find((f) => f.name === 'dropped.bin' && f.uploaded),
      { timeoutMs: 120_000, intervalMs: 1000 },
    )
    const cached = async () =>
      (await mac.sql<{ fileId: string }>('SELECT fileId FROM fs WHERE fileId = ?', file.id))
        .length > 0
    const recorded = async () =>
      (
        await mac.sql<{ bytes: number; whole: number }>(
          'SELECT bytes, whole FROM mount_copies WHERE fileId = ?',
          file.id,
        )
      )[0]
    await waitFor('the daemon to remove its cache copy', async () => !(await cached()), {
      timeoutMs: 30_000,
      intervalMs: 500,
    })
    await step("one eviction pass reads Finder's files", () => mac.call('cache.evict'))
    await precondition(
      'Finder alone holds the file, and the daemon has it recorded whole',
      async () => !mac.isCloudOnly('dropped.bin') && (await recorded())?.whole === 1,
    )
    checkEqual(
      'the Mac counts the file once',
      await mac.call<number>('cache.bytesOnDevice'),
      bytes.length,
    )

    await step("the system drops Finder's copy", async () => mac.finderEvict('dropped.bin'))
    check('Finder no longer holds it', mac.isCloudOnly('dropped.bin'))
    await waitFor('the daemon to forget the file', async () => !(await recorded()), {
      timeoutMs: 90_000,
      intervalMs: 1000,
    })
    check('the daemon never held a second copy', !(await cached()))
    checkEqual(
      'nothing of the file is on the Mac',
      await mac.call<number>('cache.bytesOnDevice'),
      0,
    )

    checkEqual(
      'Finder opens it again with its bytes',
      sha256(await mac.finderRead('dropped.bin')),
      sha256(bytes),
    )
    // The download leaves a cache copy until the daemon reads that Finder took the file.
    await waitFor(
      'the daemon to record Finder holding the file and remove its cache copy',
      async () => (await recorded())?.whole === 1 && !(await cached()),
      { timeoutMs: 120_000, intervalMs: 1000 },
    )
    check('Finder still holds the file', !mac.isCloudOnly('dropped.bin'))
  },
})
