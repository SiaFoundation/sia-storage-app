import { createHash } from 'node:crypto'
import { defineScenario } from '../../src/scenario'

const TIFF = new Uint8Array([0x49, 0x49, 0x2a, 0x00, ...new Array(252).fill(0)])

export default defineScenario({
  name: 'a raw photo stored as TIFF is given its raw type the next time a device starts',
  description:
    'Another device already published a DNG stored as image/tiff, as byte detection once typed every raw photo built on TIFF. The laptop and the desk sync it down. The laptop restarts, and both devices end with the photo stored as image/dng.',
  devices: { laptop: 'cli', desk: 'cli' },
  knownBug:
    'Nothing gives a raw photo already stored as TIFF its raw type, so it stays image/tiff on every device.',
  bugShowsAs: ['laptop', 'desk'].map((device) => ({
    check: `${device} stores it as image/dng`,
    got: 'image/tiff',
  })),
  async run({ devices: { laptop, desk }, network, converge, step, checkEqual, waitFor }) {
    const now = Date.now()
    await step('another device has published a DNG stored as image/tiff', () =>
      network.inject({
        metadata: {
          id: 'legacy-dng',
          name: 'IMG_0001.DNG',
          type: 'image/tiff',
          kind: 'file',
          size: TIFF.length,
          hash: `sha256:${createHash('sha256').update(TIFF).digest('hex')}`,
          createdAt: now,
          updatedAt: now,
          trashedAt: null,
        },
        data: TIFF,
      }),
    )
    const typeOn = async (device: typeof laptop) =>
      (await device.sql<{ type: string }>("SELECT type FROM files WHERE id = 'legacy-dng'"))[0]
        ?.type
    // The network publishes an injected object on its next whole second, so
    // a converge started now passes on two libraries that are both still empty.
    await step('both devices sync it down', async () => {
      for (const device of [laptop, desk]) {
        await waitFor(`${device.name} to hold the photo`, () => typeOn(device), {
          timeoutMs: 20_000,
          intervalMs: 500,
        })
      }
      await converge()
    })
    await step('the laptop restarts', async () => {
      await laptop.stop()
      await laptop.start()
    })
    for (const [name, device] of Object.entries({ laptop, desk })) {
      const type = await waitFor(
        `${name} to store it as image/dng`,
        async () => ((await typeOn(device)) === 'image/dng' ? 'image/dng' : undefined),
        { timeoutMs: 20_000, intervalMs: 1000 },
      ).catch(() => typeOn(device))
      checkEqual(`${name} stores it as image/dng`, type, 'image/dng')
    }
  },
})
