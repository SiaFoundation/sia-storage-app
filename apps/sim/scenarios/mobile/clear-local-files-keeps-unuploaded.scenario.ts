import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: 'Clear local files keeps files that have not uploaded, even with bytes under an old extension or no local record',
  description:
    'The phone is offline and imports two files, which cannot upload. The first file’s bytes are moved to an extension its type no longer names, and the second loses its local record, as a crash or an older version could leave them. The user runs Clear local files from Developers. Both files still have their bytes afterwards, and the second has its record back.',
  devices: { phone: 'phone' },
  timeoutMs: 6 * 60_000,
  async run({ devices: { phone }, network, seed, step, check, checkEqual, waitFor }) {
    await network.setOffline('phone', true)
    const [file, unrecorded] = await step('phone imports two files while offline', () =>
      seed('phone', { count: 2, size: 8192, prefix: 'keep' }),
    )
    const [row] = await phone.sql<{ type: string }>('SELECT type FROM files WHERE id = ?1', file.id)
    const uri = await phone.call<string>('fs.uri', { id: file.id, type: row.type })
    const stale = uri.replace(/\.[^./]+$/, '.txt')
    await step('its bytes are moved to an extension its type does not name', () =>
      phone.moveAppFile(uri, stale),
    )
    // A crash after the bytes land and before their record is written leaves this.
    await step('the second file loses its local record', () =>
      phone.call('fs.deleteMeta', unrecorded.id),
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
    // A sweep that never ran leaves the bytes under the old extension, where
    // the check above cannot see them, so the files on disk are counted too.
    // fs.listFiles returns full paths.
    const onDisk = (await phone.call<string[]>('fs.listFiles')).filter((path) =>
      (path.split('/').pop() ?? '').startsWith(file.id),
    )
    checkEqual('Clear local files leaves the file’s bytes on disk', onDisk.length, 1)
    const unrecordedOnDisk = (await phone.call<string[]>('fs.listFiles')).filter((path) =>
      (path.split('/').pop() ?? '').startsWith(unrecorded.id),
    ).length
    const [record] = await phone.sql<{ n: number }>(
      'SELECT count(*) AS n FROM fs WHERE fileId = ?1',
      unrecorded.id,
    )
    checkEqual(
      'Clear local files keeps the bytes of a file with no local record, and records them',
      { bytesOnDisk: unrecordedOnDisk, record: record?.n },
      { bytesOnDisk: 1, record: 1 },
    )
    await network.setOffline('phone', false)
  },
})
