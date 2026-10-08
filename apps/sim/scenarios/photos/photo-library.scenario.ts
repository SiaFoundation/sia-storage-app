import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { sha256 } from '../../src/integrity'
import { defineScenario } from '../../src/scenario'
import { seedPhotos } from '../../src/seed'
import { fileHashes, photoAccess, photoImportStates } from './photos'

export default defineScenario({
  name: 'importing the whole photo library brings in photos already on the phone and they reach the laptop',
  description:
    'Three photos are added to the phone’s library, then the phone imports its whole photo library, as the Import photo library sheet does. When the walk finishes every row is added, or a duplicate of a photo the library holds twice, the three photos are among the phone’s files, and the laptop gets everything the phone imported.',
  devices: { phone: 'phone', laptop: 'cli' },
  intermittentBug:
    'The uploader can queue a file that a database poll is about to return as well, so the file is added to the batch twice, uploaded twice and pinned twice.',
  bugShowsAs: [
    { check: 'no file’s bytes are pinned twice', matches: (hashes: string[]) => hashes.length > 0 },
  ],
  timeoutMs: 10 * 60_000,
  async run(ctx) {
    const {
      devices,
      converge,
      step,
      precondition,
      waitFor,
      check,
      checkEqual,
      checkContent,
      note,
      workDir,
    } = ctx
    const phone = devices.phone
    await photoAccess(phone, ctx)
    // Unique names, since Android pushes every photo into one folder under its
    // file name, and a fixed name would overwrite a photo that a failed removal
    // left there from an earlier run.
    const photos = seedPhotos(`${workDir}/library`, {
      count: 3,
      prefix: `library-photo-${crypto.randomUUID().slice(0, 8)}`,
    })
    // A new simulator's library ships with a few photos, so the app has to see
    // three more than it did, not merely three.
    const before = await phone.call<number>('sim.photoLibraryCount')
    await step('three photos are in the library', () => phone.addPhotos(photos))
    // A pooled emulator's app can go a few seconds after the grant seeing no
    // photos, and a walk that starts then finds an empty library and ends.
    await precondition('the app sees the added photos', () =>
      waitFor(
        'the app’s library query to list them',
        async () =>
          (await phone.call<number>('sim.photoLibraryCount')) >= before + photos.length ||
          undefined,
      ),
    )
    await step('import the photo library', () => phone.call('sim.startArchiveSync'))
    const states = await step('the walk finishes', () =>
      waitFor(
        'the library import to finish',
        async () => {
          // The walk keeps its position here, and an unset position means done.
          const cursor = await phone.call<string | null>('storage.getItem', 'archiveSyncCursor')
          const s = await photoImportStates(phone, 'library-scan')
          return (cursor ?? 'done') === 'done' && s.added && !s.pending && !s.active ? s : undefined
        },
        { timeoutMs: 300_000, intervalMs: 1000 },
      ),
    )
    // A new simulator ships with a few photos, so the count is at least the
    // three added here.
    note(`the walk imported ${states.added} photos`)
    // A pooled phone's library can hold the same photo twice, and the second
    // copy is rightly a duplicate.
    checkEqual(
      'every row the walk created is added or a duplicate',
      Object.keys(states).filter((state) => state !== 'added' && state !== 'duplicate'),
      [],
    )
    const onPhone = await fileHashes(phone)
    for (const photo of photos) {
      check(
        `${basename(photo)} is among the phone’s files`,
        onPhone.has(sha256(readFileSync(photo))),
      )
    }
    await step('both converge', () => converge(undefined, { timeoutMs: 300_000 }))
    await checkContent()
  },
})
