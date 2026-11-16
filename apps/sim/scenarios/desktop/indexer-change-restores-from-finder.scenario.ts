import { sha256 } from '../../src/integrity'
import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: 'after the indexer is changed, a file only Finder holds comes back to the Mac to upload again',
  description:
    "A file saved in Finder uploads and the Mac's daemon removes its cache copy, since Finder holds the file. The Mac goes offline and its indexer address is changed, so the file counts as not uploaded, with its bytes only in Finder, where the uploader never reads. The daemon asks the system to hand the file back. The system calls the extension with the file's contents, and the daemon keeps them as the cache copy of the same version, making no new one. Back online the file is uploaded again, the cache copy goes, and Finder still opens the file with its bytes.",
  devices: { mac: 'desktop' },
  timeoutMs: 6 * 60_000,
  skipStandardChecks: {
    pinnedOnce:
      'The session has one network standing in for both indexers, so the upload to the new address pins the same bytes there a second time.',
  },
  async run({ devices, network, step, precondition, check, checkEqual, waitFor }) {
    const { mac } = devices
    const bytes = crypto.getRandomValues(new Uint8Array(256 * 1024))
    await step('a file is saved in Finder', () => mac.finderWrite('moved.bin', bytes))
    const file = await waitFor(
      'the file to upload',
      async () => (await mac.library()).find((f) => f.name === 'moved.bin' && f.uploaded),
      { timeoutMs: 120_000, intervalMs: 1000 },
    )
    const cached = async () =>
      (await mac.sql<{ fileId: string }>('SELECT fileId FROM fs WHERE fileId = ?', file.id))
        .length > 0
    const uploaded = async () =>
      (await mac.call<{ uploaded: boolean } | null>('provider.item', file.id))?.uploaded === true
    await waitFor('the daemon to remove its cache copy', async () => !(await cached()), {
      timeoutMs: 30_000,
      intervalMs: 500,
    })

    await step('the Mac goes offline and its indexer address is changed', async () => {
      await network.setOffline('mac', true)
      await mac.cli('config', 'set', 'indexerUrl', 'https://next.indexer.example')
    })
    await precondition(
      'the file counts as not uploaded, with no cache copy',
      async () => !(await uploaded()) && !(await cached()),
    )

    const answers = await step('the daemon asks the system to hand the file back', () =>
      mac.call<Record<string, string>>('mount.resend', [file.id]),
    )
    checkEqual('the system takes the request', answers, { [file.id]: 'asked' })
    await waitFor('the file to be in the cache again', cached, {
      timeoutMs: 60_000,
      intervalMs: 500,
    })
    const versions = await mac.sql<{ id: string }>(
      "SELECT id FROM files WHERE name = 'moved.bin' AND kind = 'file'",
    )
    checkEqual('no new version was made for the bytes that came back', versions, [{ id: file.id }])

    await step('the Mac comes back online', () => network.setOffline('mac', false))
    await waitFor('the file to be uploaded again', uploaded, {
      timeoutMs: 120_000,
      intervalMs: 1000,
    })
    await waitFor('the cache copy to go again', async () => !(await cached()), {
      timeoutMs: 30_000,
      intervalMs: 500,
    })
    check('Finder still holds the file', !mac.isCloudOnly('moved.bin'))
    checkEqual(
      'Finder opens it with its bytes',
      sha256(await mac.finderRead('moved.bin')),
      sha256(bytes),
    )
  },
})
