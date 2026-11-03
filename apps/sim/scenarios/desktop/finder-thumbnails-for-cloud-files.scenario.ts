import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomPng } from '../../src/seed'
import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: "photos a laptop adds show their own thumbnails in the Mac's Finder folder without downloading",
  description:
    "The laptop adds a landscape and a portrait image and a text file. On the Mac, Quick Look, which Finder draws its icons through, gets each image's thumbnail from the File Provider extension with the image's shape while the file stays cloud-only, and the text file gets its type's icon. When the laptop saves a portrait image over the landscape one, the Mac's thumbnail turns portrait.",
  devices: { mac: 'desktop', laptop: 'cli' },
  timeoutMs: 8 * 60_000,
  async run({ devices, converge, step, check, checkEqual, waitFor }) {
    const { mac, laptop } = devices
    const staged = mkdtempSync(join(tmpdir(), 'sim-thumbs-'))
    writeFileSync(join(staged, 'landscape.png'), randomPng(300, 200))
    writeFileSync(join(staged, 'portrait.png'), randomPng(200, 300))
    writeFileSync(join(staged, 'notes.txt'), 'no picture in here')

    await step('laptop adds two images and a text file to pics/', async () => {
      const added = await laptop.cli('import', staged, 'pics')
      if (added.exitCode !== 0) throw new Error(added.stderr || added.stdout)
    })
    await step('both converge', () => converge())
    await step('the files appear in the Finder folder', () =>
      waitFor(
        'pics/ to list all three',
        () =>
          ['landscape.png', 'portrait.png', 'notes.txt'].every((n) =>
            mac.finderList('pics').includes(n),
          ),
        { timeoutMs: 60_000, intervalMs: 500 },
      ),
    )

    // A request that fails, because the thumbnail has not synced yet, is not
    // kept by Quick Look, so asking again until it arrives is safe.
    const thumbnailOf = (path: string) =>
      waitFor(
        `${path} to have a thumbnail`,
        () => {
          const t = mac.finderThumbnail(path)
          return t.kind === 'thumbnail' ? t : undefined
        },
        { timeoutMs: 60_000, intervalMs: 2000 },
      )

    const landscape = await step('Quick Look draws landscape.png', () =>
      thumbnailOf('pics/landscape.png'),
    )
    const portrait = await step('Quick Look draws portrait.png', () =>
      thumbnailOf('pics/portrait.png'),
    )
    check('landscape.png has a wide thumbnail', landscape.width > landscape.height)
    check('portrait.png has a tall thumbnail', portrait.height > portrait.width)
    checkEqual(
      'the text file gets the icon for its type',
      mac.finderThumbnail('pics/notes.txt').kind,
      'icon',
    )
    checkEqual(
      'the images are still cloud-only',
      ['pics/landscape.png', 'pics/portrait.png'].filter((p) => !mac.isCloudOnly(p)),
      [],
    )

    const edited = mkdtempSync(join(tmpdir(), 'sim-thumbs-edit-'))
    writeFileSync(join(edited, 'landscape.png'), randomPng(200, 320))
    const before = mac.finderState('pics/landscape.png').size
    await step('laptop saves a portrait image as landscape.png', async () => {
      const added = await laptop.cli('add', join(edited, 'landscape.png'), 'pics')
      if (added.exitCode !== 0) throw new Error(added.stderr || added.stdout)
    })
    await step('the new version reaches the Finder folder', () =>
      waitFor(
        'landscape.png to change size',
        () => mac.finderState('pics/landscape.png').size !== before,
        { timeoutMs: 120_000, intervalMs: 1000 },
      ),
    )
    const after = await step('Quick Look draws the new version', () =>
      waitFor(
        'landscape.png to have a tall thumbnail',
        () => {
          const t = mac.finderThumbnail('pics/landscape.png')
          return t.kind === 'thumbnail' && t.height > t.width ? t : undefined
        },
        { timeoutMs: 60_000, intervalMs: 2000 },
      ),
    )
    check('the edited file has the new tall thumbnail', after.height > after.width)
    check('the edited file is still cloud-only', mac.isCloudOnly('pics/landscape.png'))
    check(
      'the extension logged serving thumbnails',
      /thumbnails asked \d+ served [1-9]/.test(mac.extensionLog(10)),
    )
  },
})
