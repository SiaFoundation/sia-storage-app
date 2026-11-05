import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: 'a file the library has no record of is removed from the phone 30 seconds after the app comes back to the foreground',
  description:
    'The phone imports 2 files and uploads them. One file’s bytes are moved to a name no file in the library has, as a cleared library or another account leaves them, and the daily orphan scan is marked as never run. The phone goes to the background and comes back. 30 seconds later, without anyone opening Developers, the stray copy is deleted and the other file’s copy stays.',
  devices: { phone: 'phone' },
  timeoutMs: 6 * 60_000,
  async run({ devices: { phone }, network, seed, step, check, waitFor }) {
    const [moved, kept] = await step('phone imports 2 files', () =>
      seed('phone', { count: 2, size: 64 * 1024, prefix: 'stray' }),
    )
    await waitFor(
      'both files to upload',
      async () => ((await network.objects()).length >= 2 ? true : undefined),
      { timeoutMs: 120_000, intervalMs: 1000 },
    )
    const typeOf = async (id: string) =>
      (await phone.sql<{ type: string }>('SELECT type FROM files WHERE id = ?1', id))[0].type
    const movedUri = await phone.call<string>('fs.uri', {
      id: moved.id,
      type: await typeOf(moved.id),
    })
    const keptUri = await phone.call<string>('fs.uri', { id: kept.id, type: await typeOf(kept.id) })
    const strayUri = movedUri.replace(/[^/]+$/, 'stray-copy.bin')
    await step('move one file’s bytes to a name the library does not know', async () => {
      await phone.moveAppFile(movedUri, strayUri)
      // Uploaded, so with no local record it reads as on the network only.
      await phone.call('fs.deleteMeta', moved.id)
    })
    await step('mark the daily orphan scan as never run', () =>
      phone.call('settings.setFsOrphanLastRun', 0),
    )
    await step('send the phone to the background', () => phone.background())
    await step('bring it back', () => phone.foreground())

    const name = (uri: string) => uri.split('/').pop() ?? ''
    const listed = async () => (await phone.call<string[]>('fs.listFiles')).map(name)
    check(
      'the stray copy is still there just after the app returns',
      (await listed()).includes(name(strayUri)),
    )
    const gone = await waitFor(
      'the stray copy to be deleted',
      async () => ((await listed()).includes(name(strayUri)) ? undefined : true),
      // The scan starts 30 seconds after the app returns to the foreground.
      { timeoutMs: 90_000, intervalMs: 1000 },
    ).catch(() => false)
    check('the stray copy is deleted without the user asking', gone === true)
    check('the other file’s copy is still on the phone', (await listed()).includes(name(keptUri)))
  },
})
