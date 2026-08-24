import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineScenario } from '../../src/scenario'

/** The first bytes of a Canon CR3: an ISO base media `ftyp` box with brand `crx `. */
function cr3Header(): Uint8Array {
  const out = new Uint8Array(4096)
  out.set([0x00, 0x00, 0x00, 0x18], 0)
  out.set(new TextEncoder().encode('ftypcrx '), 4)
  out.set([0x00, 0x00, 0x00, 0x01], 12)
  out.set(new TextEncoder().encode('crx isom'), 16)
  return out
}

export default defineScenario({
  name: 'a Canon raw photo with no extension is stored as CR3 on every device',
  description:
    'The laptop adds a file holding a Canon CR3 photo and named with no extension. The laptop and a second device store it as image/x-canon-cr3, the type its bytes name.',
  devices: { laptop: 'cli', desk: 'cli' },
  async run({ devices, converge, step, checkEqual, workDir }) {
    const path = join(workDir, 'IMG_0001')
    writeFileSync(path, cr3Header())
    const file = await step('laptop adds a CR3 named with no extension', () =>
      devices.laptop.addFile(path),
    )
    await step('both converge', () => converge())
    for (const [name, device] of Object.entries(devices)) {
      const [row] = await device.sql<{ type: string }>(
        'SELECT type FROM files WHERE id = ?1',
        file.id,
      )
      checkEqual(`${name} stores it as image/x-canon-cr3`, row?.type, 'image/x-canon-cr3')
    }
  },
})
