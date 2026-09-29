import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { thumbnailed } from '../../src/filetypes'
import { defineScenario } from '../../src/scenario'

/** A `size` by `size` 24-bit BMP of one colour, rows padded to four bytes. */
function bmp(size: number): Uint8Array {
  const row = Math.ceil((size * 3) / 4) * 4
  const out = new Uint8Array(54 + row * size)
  const view = new DataView(out.buffer)
  out.set([0x42, 0x4d])
  view.setUint32(2, out.length, true)
  view.setUint32(10, 54, true)
  view.setUint32(14, 40, true)
  view.setInt32(18, size, true)
  view.setInt32(22, size, true)
  view.setUint16(26, 1, true)
  view.setUint16(28, 24, true)
  view.setUint32(34, row * size, true)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) out.set([200, 80, 20], 54 + y * row + x * 3)
  return out
}

export default defineScenario({
  name: 'a laptop makes thumbnails for BMP images and does not try SVG',
  description:
    'The laptop adds a BMP image and an SVG drawing. The BMP gets a thumbnail. The SVG, which the daemon has no decoder for, gets none and logs no failed thumbnail attempt.',
  devices: { laptop: 'cli' },
  knownBug:
    "The daemon's thumbnailer lists SVG, which Bun.Image cannot decode, so each scan fails on every SVG, and leaves out BMP, which it decodes, so a BMP never gets a thumbnail.",
  bugShowsAs: [
    { check: 'the BMP has a thumbnail', got: false },
    {
      check: 'no thumbnail attempt on the SVG failed',
      // Bun.Image has no SVG decoder, so preparing the source fails.
      matches: (lines: string[]) =>
        lines.length > 0 && lines.every((l) => l.includes('source_prepare_error')),
    },
  ],
  async run({ devices: { laptop }, step, check, checkEqual, waitFor, workDir }) {
    const bmpPath = join(workDir, 'swatch.bmp')
    const svgPath = join(workDir, 'drawing.svg')
    writeFileSync(bmpPath, bmp(64))
    writeFileSync(
      svgPath,
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="red"/></svg>',
    )
    // The SVG goes in first, so any scan that thumbnails the BMP also found the SVG.
    const svg = await step('laptop adds an SVG and a BMP', async () => {
      const added = await laptop.addFile(svgPath)
      await laptop.addFile(bmpPath)
      return added
    })
    const got = await waitFor(
      'a thumbnail for the BMP',
      async () => ((await thumbnailed(laptop)).has('swatch.bmp') ? true : undefined),
      { timeoutMs: 45_000, intervalMs: 1000 },
    ).catch(() => false)
    checkEqual('the BMP has a thumbnail', got, true)
    check('the SVG has no thumbnail', !(await thumbnailed(laptop)).has('drawing.svg'))
    const failures = (await laptop.logs(5000))
      .split('\n')
      .filter(
        (l) => l.includes('[thumbnailer]') && l.includes(svg.id) && /\b(WARN|ERROR)\b/.test(l),
      )
    checkEqual('no thumbnail attempt on the SVG failed', failures.slice(0, 3), [])
  },
})
