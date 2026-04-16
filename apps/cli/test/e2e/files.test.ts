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

describe('file operations', () => {
  it('add prints Added', async () => {
    const file = ctx.createTempFile('test.txt', 'hello world')
    const r = await ctx.sia('add', file)
    expect(r.stdout).toContain('Added')
    expect(r.stdout).toContain('test.txt')
  })

  it('root ls shows unfiled files inline', async () => {
    const file = ctx.createTempFile('readme.md', '# Hello')
    await ctx.sia('add', file)
    const r = await ctx.sia('ls')
    expect(r.stdout).toContain('readme.md')
    expect(r.stdout).not.toContain('No folder')
  })

  it('add to directory with --dir', async () => {
    const file = ctx.createTempFile('photo.jpg', Buffer.alloc(1024))
    await ctx.sia('mkdir', 'photos')
    await ctx.sia('add', file, '--dir', 'photos')
    const r = await ctx.sia('ls')
    expect(r.stdout).toContain('photos')
  })

  it('add to directory with positional arg', async () => {
    const file = ctx.createTempFile('doc.pdf', Buffer.alloc(100))
    await ctx.sia('mkdir', 'work')
    await ctx.sia('add', file, 'work/')
    const r = await ctx.sia('ls', 'work')
    expect(r.stdout).toContain('doc.pdf')
  })

  it('info with dir/filename path', async () => {
    const file = ctx.createTempFile('report.txt', 'some content here')
    await ctx.sia('mkdir', 'docs')
    await ctx.sia('add', file, '--dir', 'docs')
    const r = await ctx.sia('info', 'docs/report.txt')
    expect(r.stdout).toContain('report.txt')
    expect(r.stdout).toContain('Size')
  })

  it('rm with dir/filename path', async () => {
    const file = ctx.createTempFile('deleteme.txt', 'bye')
    await ctx.sia('mkdir', 'temp')
    await ctx.sia('add', file, '--dir', 'temp')

    await ctx.sia('rm', 'temp/deleteme.txt')

    const r = await ctx.sia('ls', 'temp')
    expect(r.stdout).not.toContain('deleteme.txt')
  })

  it('rm unfiled file by bare name', async () => {
    const file = ctx.createTempFile('orphan.txt', 'data')
    await ctx.sia('add', file)

    await ctx.sia('rm', 'orphan.txt')

    const r = await ctx.sia('ls')
    expect(r.stdout).not.toContain('orphan.txt')
  })
})
