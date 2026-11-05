import { defineScenario } from '../../src/scenario'

/** A stored file's id: its name without the folder or the extension. */
function fileIdOf(path: string): string {
  const name = path.split('/').pop() ?? ''
  const dot = name.indexOf('.')
  return dot === -1 ? name : name.slice(0, dot)
}

export default defineScenario({
  name: 'Clear local data and resync deletes the phone’s copies of the library it drops',
  description:
    'The phone imports 3 files and uploads them, so it holds a local copy of each. It goes offline, so nothing can be downloaded again, and the user runs Clear local data and resync from the menu. Once the app is back, none of the 3 copies is left in its files folder. Back online, the library syncs down again.',
  devices: { phone: 'phone' },
  timeoutMs: 6 * 60_000,
  async run({ devices: { phone }, network, seed, step, checkEqual, waitFor, converge }) {
    const files = await step('phone imports 3 files', () =>
      seed('phone', { count: 3, size: 64 * 1024, prefix: 'resync' }),
    )
    await waitFor(
      'every file to upload',
      async () => ((await network.objects()).length >= files.length ? true : undefined),
      { timeoutMs: 120_000, intervalMs: 1000 },
    )
    const seeded = new Set(files.map((f) => f.id))
    const copiesOnDisk = async () =>
      (await phone.call<string[]>('fs.listFiles')).map(fileIdOf).filter((id) => seeded.has(id))
    checkEqual(
      'the phone holds a copy of each file before the reset',
      (await copiesOnDisk()).length,
      3,
    )

    await network.setOffline('phone', true)
    const ui = phone.ui()
    await step('Clear local data and resync from the menu', async () => {
      await ui.tap({ label: 'Menu' })
      await ui.scrollTo({ text: 'Clear local data and resync' })
      await ui.tap({ text: 'Clear local data and resync' })
      await ui.tap({ text: 'Clear and resync' })
    })
    await ui.close()
    // The app restarts its services during the reset, so a call can fail
    // while it runs.
    const left = await waitFor(
      'the copies to be gone from the files folder',
      async () => {
        const ids = await copiesOnDisk().catch(() => undefined)
        return ids?.length === 0 ? ids : undefined
      },
      { timeoutMs: 60_000, intervalMs: 1000 },
    ).catch(() => copiesOnDisk())
    checkEqual('no copy of the dropped library is left on the phone', left, [])

    await network.setOffline('phone', false)
    await step('the library syncs back', () => converge(undefined, { timeoutMs: 120_000 }))
  },
})
