import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { sha256 } from '../../src/integrity'
import { defineScenario } from '../../src/scenario'
import { seedPhotos } from '../../src/seed'
import { fileHashes, photoAccess, photoImportStates } from './photos'

export default defineScenario({
  name: 'importing the whole photo library brings in photos already on the phone and they reach the laptop',
  description:
    'Three photos are added to the phone’s library, then the phone imports its whole photo library, as the Import photo library sheet does. When the walk finishes every row is added, the three photos are among the phone’s files, and the laptop gets everything the phone imported.',
  devices: { phone: 'phone', laptop: 'cli' },
  timeoutMs: 10 * 60_000,
  async run(ctx) {
    const { devices, converge, step, waitFor, check, checkEqual, checkContent, note, workDir } = ctx
    const phone = devices.phone
    await photoAccess(phone, ctx)
    // Unique names, since a pooled emulator keeps earlier runs' photos in the
    // one folder Android pushes them to, and a fixed name would overwrite one.
    const photos = seedPhotos(`${workDir}/library`, {
      count: 3,
      prefix: `library-photo-${crypto.randomUUID().slice(0, 8)}`,
    })
    await step('three photos are in the library', () => phone.addPhotos(photos))
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
    // A pooled simulator keeps photos earlier scenarios added, and a new one
    // ships with a few, so the count is at least the three added here.
    note(`the walk imported ${states.added} photos`)
    checkEqual('every row the walk created is added', Object.keys(states), ['added'])
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
