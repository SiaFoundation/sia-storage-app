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

describe('directory operations', () => {
  it('mkdir creates directory visible in ls', async () => {
    await ctx.sia('mkdir', 'photos')
    const r = await ctx.sia('ls')
    expect(r.stdout).toContain('photos')
  })

  it('mkdir creates nested directories', async () => {
    await ctx.sia('mkdir', 'photos/2024')
    const r = await ctx.sia('ls')
    expect(r.stdout).toContain('photos')
    const r2 = await ctx.sia('ls', 'photos')
    expect(r2.stdout).toContain('2024')
  })

  it('ls with trailing slash works', async () => {
    await ctx.sia('mkdir', 'docs')
    const r1 = await ctx.sia('ls', 'docs')
    const r2 = await ctx.sia('ls', 'docs/')
    expect(r1.exitCode).toBe(0)
    expect(r2.exitCode).toBe(0)
  })

  it('mv file into directory with trailing slash', async () => {
    await ctx.startDaemon()
    const file = ctx.createTempFile('note.txt', 'data')
    await ctx.sia('add', file)
    await ctx.sia('mkdir', 'notes')

    await ctx.sia('mv', 'note.txt', 'notes/')

    const r = await ctx.sia('ls', 'notes')
    expect(r.stdout).toContain('note.txt')
  })

  it('rm -r with trailing slash works', async () => {
    await ctx.startDaemon()
    const file = ctx.createTempFile('tmp.txt', 'data')
    await ctx.sia('mkdir', 'temp')
    await ctx.sia('add', file, '--dir', 'temp')

    const r = await ctx.sia('rm', '-r', 'temp/')
    expect(r.stdout).toContain('Removed')
  })

  it('multiple directories listed', async () => {
    await ctx.sia('mkdir', 'photos')
    await ctx.sia('mkdir', 'documents')
    const r = await ctx.sia('ls')
    expect(r.stdout).toContain('photos')
    expect(r.stdout).toContain('documents')
  })
})
