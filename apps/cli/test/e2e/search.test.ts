jest.setTimeout(60_000)
import { createE2eContext } from './helpers'

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

describe('search', () => {
  it('finds files matching query', async () => {
    const file1 = ctx.createTempFile('vacation-photo.jpg', Buffer.alloc(100))
    const file2 = ctx.createTempFile('budget.xlsx', Buffer.alloc(100))
    await ctx.sia('add', file1)
    await ctx.sia('add', file2)

    const r = await ctx.sia('search', 'vacation')
    expect(r.stdout).toContain('vacation-photo.jpg')
    expect(r.stdout).not.toContain('budget.xlsx')
  })

  it('shows no results for non-matching query', async () => {
    const r = await ctx.sia('search', 'zzzzzzz')
    expect(r.stdout.toLowerCase()).toContain('no result')
  })
})
