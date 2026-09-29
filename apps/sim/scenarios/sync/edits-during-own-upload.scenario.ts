import { defineScenario } from '../../src/scenario'
import { uploadInFlight } from '../steps'

export default defineScenario({
  name: 'a rename, a trash and a delete made while the file is still uploading all hold',
  description:
    'Uploads are slowed and the phone adds 4 files of 512 KB. While they upload it renames one, trashes one and deletes one. The rename reaches the laptop, the deleted file is on neither device nor pinned on the network, the trashed file stays trashed, and it reaches the laptop once it is restored.',
  devices: { phone: 'cli', laptop: 'cli' },
  timeoutMs: 4 * 60_000,
  async run(ctx) {
    const {
      devices: { phone, laptop },
      network,
      seed,
      converge,
      step,
      check,
      checkEqual,
      checkContent,
      precondition,
      waitFor,
    } = ctx
    await network.setConditions({ uploadBytesPerSec: 64 * 1024 })
    const [a, b, c] = await step('phone adds 4 files of 512 KB', () =>
      seed('phone', { count: 4, size: 512 * 1024 }),
    )
    await uploadInFlight(ctx, 'phone', 4)
    await precondition('the files to be edited are uploading together in one batch', () =>
      waitFor(
        'the uploader to mark the three files as uploading in one batch',
        async () => {
          const entries = await Promise.all(
            [a, b, c].map((f) =>
              phone.call<{ status: string; batchId?: string } | null>('uploads.getEntry', f.id),
            ),
          )
          const batchId = entries[0]?.batchId
          return (
            batchId !== undefined &&
            entries.every((e) => e?.status === 'uploading' && e.batchId === batchId)
          )
        },
        { timeoutMs: 60_000 },
      ),
    )
    await step('phone renames, trashes and deletes during the upload', async () => {
      await phone.call('files.renameFile', a.id, 'renamed-mid-upload.bin')
      await phone.call('files.trashFile', b.id)
      await phone.call('files.tombstoneFile', c.id)
    })
    await network.setConditions({ uploadBytesPerSec: 0 })
    // The mock fixes an upload's commit time when the upload starts, at the
    // rate then in force, so clearing the rate does not bring it forward. A
    // trash check before that upload saves the file would pass regardless.
    await precondition('the upload in flight pins the trashed file', () =>
      waitFor(
        'the trashed file to be pinned and recorded as uploaded on the phone',
        async () =>
          (await network.objects()).some((o) => o.metadata?.id === b.id) &&
          (await phone.library()).find((f) => f.id === b.id)?.uploaded,
        { timeoutMs: 90_000 },
      ),
    )
    checkEqual(
      'the trashed file stays trashed on the phone',
      (await phone.library()).find((f) => f.id === b.id)?.trashed,
      true,
    )
    await step('phone restores the trashed file', () => phone.call('files.restore', [b.id]))
    await step('both converge', () => converge(undefined, { timeoutMs: 120_000 }))

    const onLaptop = new Map((await laptop.library()).map((f) => [f.id, f]))
    checkEqual('the rename reached the laptop', onLaptop.get(a.id)?.name, 'renamed-mid-upload.bin')
    checkEqual(
      'the restored file reached the laptop, not trashed',
      onLaptop.get(b.id)?.trashed,
      false,
    )
    check('the deleted file is not on the laptop', !onLaptop.has(c.id))
    check(
      'the deleted file is not pinned on the network',
      !(await network.objects()).some((o) => o.metadata?.id === c.id),
    )
    await checkContent()
  },
})
