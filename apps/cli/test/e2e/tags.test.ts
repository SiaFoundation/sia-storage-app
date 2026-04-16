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

describe('tag operations', () => {
  it('tag adds tag and shows in tags list', async () => {
    const file = ctx.createTempFile('first.txt', 'data')
    await ctx.sia('add', file)
    await ctx.sia('tag', 'first.txt', 'custom-tag')
    const r = await ctx.sia('tags')
    expect(r.stdout).toContain('custom-tag')
  })

  it('tag adds tag to file', async () => {
    const file = ctx.createTempFile('work.txt', 'data')
    await ctx.sia('add', file)
    await ctx.sia('tag', 'work.txt', 'important')

    const r = await ctx.sia('tags')
    expect(r.stdout).toContain('important')
  })

  it('info shows tags', async () => {
    const file = ctx.createTempFile('tagged.txt', 'data')
    await ctx.sia('add', file)
    await ctx.sia('tag', 'tagged.txt', 'work')

    const r = await ctx.sia('info', 'tagged.txt')
    expect(r.stdout).toContain('work')
  })

  it('untag removes tag', async () => {
    const file = ctx.createTempFile('untagme.txt', 'data')
    await ctx.sia('add', file)
    await ctx.sia('tag', 'untagme.txt', 'temp')
    await ctx.sia('untag', 'untagme.txt', 'temp')

    const r = await ctx.sia('info', 'untagme.txt')
    expect(r.stdout).not.toContain('temp')
  })
})
