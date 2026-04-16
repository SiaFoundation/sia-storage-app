jest.setTimeout(60_000)
import { createE2eContext } from './helpers'

let ctx: ReturnType<typeof createE2eContext>

beforeEach(() => {
  ctx = createE2eContext()
})

afterEach(async () => {
  await ctx.stopDaemon().catch(() => {})
  ctx.cleanup()
})

describe('connect flow', () => {
  it('connect in test mode auto-connects', async () => {
    const r = await ctx.sia('connect')
    expect(r.stdout).toContain('Connected successfully')
  })

  it('config shows indexer URL after connect', async () => {
    await ctx.sia('connect')
    const r = await ctx.sia('config')
    expect(r.stdout).toContain('https://sia.storage')
    expect(r.stdout).toContain('yes')
  })

  it('daemon start after connect shows connected', async () => {
    await ctx.sia('connect')
    await ctx.startDaemon()
    const r = await ctx.sia('daemon', 'status')
    expect(r.stdout).toContain('running')
  })
})
