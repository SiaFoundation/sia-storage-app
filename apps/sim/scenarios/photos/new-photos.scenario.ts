import { readFileSync } from 'node:fs'
import { pinnedTwice, sha256 } from '../../src/integrity'
import { defineScenario } from '../../src/scenario'
import { seedPhotos } from '../../src/seed'
import { fileHashes, fileObjects, photoAccess, photoImportStates } from './photos'

export default defineScenario({
  name: 'photos taken after turning on Import new photos are imported once, uploaded and reach the laptop',
  description:
    'The phone turns on Import new photos, which treats the photos already in its library as seen. Three new photos then appear in the library. The phone imports exactly those three, uploads them, and the laptop gets them with their bytes.',
  devices: { phone: 'phone', laptop: 'cli' },
  timeoutMs: 8 * 60_000,
  async run(ctx) {
    const { devices, converge, step, waitFor, checkEqual, checkContent, network, workDir } = ctx
    const phone = devices.phone
    await photoAccess(phone, ctx)
    await step('turn on Import new photos', () => phone.call('sim.enableNewPhotoSync'))
    // Android pushes each photo into one shared folder under its file name, and a
    // pooled emulator keeps earlier runs' photos, which a fixed name would overwrite.
    const photos = seedPhotos(`${workDir}/new`, {
      count: 3,
      prefix: `new-photo-${crypto.randomUUID().slice(0, 8)}`,
    })
    await step('three photos appear in the library', () => phone.addPhotos(photos))
    const states = await step('the phone imports them', () =>
      waitFor(
        'three new photos to be added',
        async () => {
          const s = await photoImportStates(phone, 'new-photos')
          // Runs a pass only until the photos are found. A pass while they
          // are still being copied finds them again and records duplicates.
          const found = Object.values(s).reduce((a, b) => a + b, 0)
          if (found < 3) await phone.call('sim.syncNewPhotosNow')
          return s.added === 3 && !s.pending && !s.active ? s : undefined
        },
        { timeoutMs: 120_000, intervalMs: 1000 },
      ),
    )
    // The app's own 10 second pass can still find a photo twice, which it
    // records as a duplicate and does not import again.
    checkEqual(
      'the three new photos are added, and nothing else but a duplicate is recorded',
      Object.keys(states).filter((state) => state !== 'duplicate'),
      ['added'],
    )
    checkEqual('three photos are added', states.added, 3)
    const { files } = await step('both converge', () => converge(undefined, { timeoutMs: 180_000 }))
    checkEqual('both hold the three photos', files, 3)
    checkEqual('each photo is pinned once', await fileObjects(network), 3)
    checkEqual('no file’s bytes are pinned twice', await pinnedTwice(network), [])
    const onPhone = await fileHashes(phone)
    checkEqual(
      'the phone holds the three photos’ bytes',
      photos.filter((p) => onPhone.has(sha256(readFileSync(p)))).length,
      3,
    )
    await checkContent()
  },
})
