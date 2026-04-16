jest.setTimeout(60_000)
import { createE2eContext } from './helpers'

let ctx: ReturnType<typeof createE2eContext>

beforeEach(async () => {
  ctx = createE2eContext()
  await ctx.sia('connect')
})

afterEach(async () => {
  await ctx.stopDaemon().catch(() => {})
  ctx.cleanup()
})

describe('status', () => {
  it('auto-starts daemon and shows running', async () => {
    const r = await ctx.sia('status')
    expect(r.stdout).toContain('running')
    expect(r.stdout).toContain('Library')
  })

  it('shows upload and directory info', async () => {
    await ctx.sia('mkdir', 'photos')
    const r = await ctx.sia('status')
    expect(r.stdout).toContain('Directories')
    expect(r.stdout).toContain('photos')
  })
})
