jest.setTimeout(60_000)
import * as fs from 'fs'
import * as path from 'path'
import { sendIpcCommand } from '@siastorage/node-adapters'
import { createE2eContext } from './helpers'

const FIXTURE_JPEG = path.resolve(__dirname, 'fixtures/photo.jpg')
const THUMB_SIZES = [64, 512]

type ThumbRecord = { id: string; thumbSize: number | null; type: string }

let ctx: ReturnType<typeof createE2eContext>

beforeEach(async () => {
  ctx = createE2eContext()
  await ctx.sia('connect')
  await ctx.startDaemon()
}, 30_000)

afterEach(async () => {
  await ctx.stopDaemon().catch(() => {})
  ctx.cleanup()
}, 15_000)

describe('thumbnail generation', () => {
  it('produces webp thumbnails for an added image via the Bun-compiled CLI', async () => {
    const src = ctx.createTempFile('photo.jpg', fs.readFileSync(FIXTURE_JPEG))
    await ctx.sia('add', src)

    const info = await ctx.sia('info', 'photo.jpg')
    const match = info.stdout.match(/ID:\s+(\S+)/)
    expect(match).toBeTruthy()
    const fileId = match![1]

    let thumbs: ThumbRecord[] = []
    const deadline = Date.now() + 20_000
    while (Date.now() < deadline) {
      thumbs = (await sendIpcCommand(ctx.paths.sockPath, 'ds:thumbnails:getForFile', {
        args: [fileId],
      })) as ThumbRecord[]
      if (thumbs.length >= THUMB_SIZES.length) break
      await new Promise((r) => setTimeout(r, 500))
    }

    const sizes = thumbs.map((t) => t.thumbSize).sort((a, b) => (a ?? 0) - (b ?? 0))
    expect(sizes).toEqual([...THUMB_SIZES].sort((a, b) => a - b))

    for (const t of thumbs) {
      expect(t.type).toBe('image/webp')
      const onDisk = path.join(ctx.paths.filesDir, `${t.id}.webp`)
      const buf = fs.readFileSync(onDisk)
      expect(buf.length).toBeGreaterThan(0)
      // WebP magic: 'RIFF' ____ 'WEBP'
      expect(buf.subarray(0, 4).toString('ascii')).toBe('RIFF')
      expect(buf.subarray(8, 12).toString('ascii')).toBe('WEBP')
    }
  })
})
