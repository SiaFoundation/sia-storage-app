import { readFileSync } from 'node:fs'
import { sha256 } from '../../src/integrity'
import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: "Clear Local Files in the Mac's window removes its backed-up copies and keeps the rest",
  description:
    "The laptop adds two files and the Mac downloads both, so it holds copies of them. With the Mac's uploads held, a third file saved in Finder is not backed up. Clear Local Files in the status window takes a second click, then removes the two backed-up copies and keeps the third, and Finder still opens all three with their bytes.",
  devices: { mac: 'desktop', laptop: 'cli' },
  timeoutMs: 8 * 60_000,
  async run({ devices, network, seed, converge, step, precondition, checkEqual, check, waitFor }) {
    const { mac } = devices
    const files = await step('the laptop adds 2 files', () =>
      seed('laptop', { count: 2, size: 64 * 1024 }),
    )
    await step('both converge', () => converge())
    await step('the Mac downloads both', async () => {
      for (const f of files) await mac.call('downloads.downloadFile', f.id, 'user')
    })

    await step('the network holds the Mac’s uploads', () =>
      network.hold({ op: 'upload', device: 'mac' }),
    )
    const unsaved = crypto.getRandomValues(new Uint8Array(32 * 1024))
    await step('a file not yet backed up is saved in Finder', () =>
      mac.finderWrite('not-backed-up.bin', unsaved),
    )
    const local = await waitFor(
      'the Mac to record the new file',
      async () => (await mac.library()).find((f) => f.name === 'not-backed-up.bin'),
      { timeoutMs: 60_000, intervalMs: 500 },
    )
    const cachedIds = async () =>
      (await mac.sql<{ fileId: string }>('SELECT fileId FROM fs')).map((r) => r.fileId)
    await precondition('the Mac holds all three copies', () =>
      waitFor(
        'the Mac to hold all three copies',
        async () => {
          const cached = await cachedIds()
          return [...files.map((f) => f.id), local.id].every((id) => cached.includes(id))
        },
        { timeoutMs: 30_000, intervalMs: 500 },
      ),
    )

    const window = mac.ui().window('main')
    await step('open the window', async () => {
      await mac.openWindow()
      await window.waitFor({ id: 'clear-local-files' }, 30_000)
    })
    await step('click Clear Local Files', () => window.tap({ id: 'clear-local-files' }))
    check(
      'the first click asks for a second',
      (await window.read({ id: 'clear-local-files' }))?.startsWith('Remove up to') ?? false,
      `${await window.read({ id: 'clear-local-files' })}`,
    )
    await step('click again to clear', () => window.tap({ id: 'clear-local-files' }))
    const notice = await waitFor(
      'the window to say what was removed',
      async () => (await window.read({ id: 'clear-notice' })) ?? undefined,
      { timeoutMs: 60_000, intervalMs: 500 },
    )
    check('the window says how much it removed', notice.startsWith('Removed '), notice)

    const cached = await cachedIds()
    checkEqual(
      'the backed-up copies are gone',
      files.filter((f) => cached.includes(f.id)).map((f) => f.name),
      [],
    )
    check('the copy not yet backed up is kept', cached.includes(local.id), cached.join(', '))

    const wrong: string[] = []
    for (const f of files) {
      if (sha256(await mac.finderRead(f.name)) !== sha256(readFileSync(f.path))) wrong.push(f.name)
    }
    if (sha256(await mac.finderRead('not-backed-up.bin')) !== sha256(unsaved)) {
      wrong.push('not-backed-up.bin')
    }
    checkEqual('Finder still opens every file with its bytes', wrong, [])

    await step('the network lets the uploads through', () => network.releaseHolds())
    await step('both converge', () => converge())
  },
})
