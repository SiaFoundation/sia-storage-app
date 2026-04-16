jest.setTimeout(60_000)
import * as fs from 'fs'
import * as path from 'path'
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

describe('watch CLI commands', () => {
  it('lists empty watch rules', async () => {
    const r = await ctx.sia('watch', 'list')
    expect(r.stdout).toContain('No watch rules configured')
  })

  it('adds a watch rule', async () => {
    const watchDir = path.join(ctx.dataDir, 'screenshots')
    fs.mkdirSync(watchDir)

    const r = await ctx.sia('watch', 'add', watchDir, '--dir', 'screenshots', '--append-id')
    expect(r.stdout).toContain('Watching')
    expect(r.stdout).toContain(watchDir)
  })

  it('lists added watch rules', async () => {
    const watchDir = path.join(ctx.dataDir, 'screenshots')
    fs.mkdirSync(watchDir)

    await ctx.sia('watch', 'add', watchDir, '--dir', 'screenshots')
    const r = await ctx.sia('watch', 'list')
    expect(r.stdout).toContain(watchDir)
    expect(r.stdout).toContain('screenshots')
  })

  it('removes a watch rule', async () => {
    const watchDir = path.join(ctx.dataDir, 'screenshots')
    fs.mkdirSync(watchDir)

    await ctx.sia('watch', 'add', watchDir, '--dir', 'screenshots')
    await ctx.sia('watch', 'rm', watchDir)
    const r = await ctx.sia('watch', 'list')
    expect(r.stdout).toContain('No watch rules configured')
  })

  it('auto-ingests new files from watched directory', async () => {
    const watchDir = path.join(ctx.dataDir, 'incoming')
    fs.mkdirSync(watchDir)

    await ctx.sia('watch', 'add', watchDir, '--dir', 'auto')

    // Create a file in the watched directory
    fs.writeFileSync(path.join(watchDir, 'test-file.txt'), 'auto-ingest test content')

    // Wait for the watch service to pick it up (runs every 5s)
    await new Promise((r) => setTimeout(r, 8000))

    const r = await ctx.sia('ls', 'auto')
    expect(r.stdout).toContain('test-file.txt')
  }, 20_000)

  it('renames screenshot files on ingest', async () => {
    const watchDir = path.join(ctx.dataDir, 'incoming')
    fs.mkdirSync(watchDir)

    await ctx.sia('watch', 'add', watchDir, '--dir', 'screenshots', '--append-id')

    // Create a macOS-style screenshot file
    fs.writeFileSync(
      path.join(watchDir, 'Screenshot 2026-04-14 at 2.30.22 PM.png'),
      'fake screenshot data',
    )

    // Wait for the watch service
    await new Promise((r) => setTimeout(r, 8000))

    const r = await ctx.sia('ls', 'screenshots')
    expect(r.stdout).toMatch(/screenshot-2026-04-14-143022-[A-Za-z0-9]{6}/)
  }, 20_000)

  it('does not re-ingest duplicate files', async () => {
    const watchDir = path.join(ctx.dataDir, 'incoming')
    fs.mkdirSync(watchDir)

    await ctx.sia('watch', 'add', watchDir, '--dir', 'auto')

    fs.writeFileSync(path.join(watchDir, 'unique.txt'), 'unique content for dedup test')

    // Wait for first ingest
    await new Promise((r) => setTimeout(r, 8000))

    // Wait for another cycle — should not create a duplicate
    await new Promise((r) => setTimeout(r, 6000))

    const r = await ctx.sia('ls', 'auto')
    const lines = r.stdout.split('\n').filter((l) => l.includes('unique.txt'))
    expect(lines).toHaveLength(1)
  }, 25_000)
})
