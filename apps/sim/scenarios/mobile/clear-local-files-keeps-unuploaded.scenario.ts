import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: 'Clear local files keeps a file that has not uploaded, even with its bytes under an old extension',
  description:
    'The phone is offline and imports a file, which cannot upload. Its bytes are moved to an extension its type no longer names, as a crash or an older version could leave them. The user runs Clear local files from Developers. The file still has its bytes afterwards.',
  devices: { phone: 'phone' },
  knownBug:
    'The sweep behind Clear local files treats bytes whose extension does not match their file’s type as belonging to no file and deletes them, so a file that has not uploaded loses its only copy.',
  bugShowsAs: ['the file still has its bytes on the phone'],
  timeoutMs: 6 * 60_000,
  async run({ devices: { phone }, network, seed, step, check, waitFor }) {
    await network.setOffline('phone', true)
    const [file] = await step('phone imports a file while offline', () =>
      seed('phone', { count: 1, size: 8192, prefix: 'keep' }),
    )
    const [row] = await phone.sql<{ type: string }>('SELECT type FROM files WHERE id = ?1', file.id)
    const uri = await phone.call<string>('fs.uri', { id: file.id, type: row.type })
    const stale = uri.replace(/\.[^./]+$/, '.txt')
    await step('its bytes are moved to an extension its type does not name', () =>
      phone.moveAppFile(uri, stale),
    )
    const ui = phone.ui()
    await step('Clear local files from Developers', async () => {
      await ui.tap({ label: 'Menu' })
      await ui.scrollTo({ label: 'Developers' })
      await ui.tap({ label: 'Developers' })
      await ui.scrollTo({ text: 'Clear local files' })
      await ui.tap({ text: 'Clear local files' })
      await ui.tap({ text: 'Clear' })
      await ui.waitFor({ text: 'Local files cleared' }, 60_000)
      await ui.tap({ text: 'OK' })
    })
    await ui.close()
    const kept = await waitFor(
      'the file to resolve to bytes on disk',
      async () =>
        (await phone.call('fs.getFileUri', { id: file.id, type: row.type })) ? true : undefined,
      { timeoutMs: 10_000, intervalMs: 1000 },
    ).catch(() => false)
    check('the file still has its bytes on the phone', kept === true)
    await network.setOffline('phone', false)
  },
})
