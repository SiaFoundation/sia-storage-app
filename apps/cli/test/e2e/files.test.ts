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

  it('download writes the file to --output', async () => {
    const content = 'hello from the download e2e test'
    const file = ctx.createTempFile('greeting.txt', content)
    await ctx.sia('add', file)

    const outputPath = path.join(ctx.dataDir, 'out', 'greeting.txt')
    const r = await ctx.sia('download', 'greeting.txt', '--output', outputPath)

    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('Downloaded')
    expect(r.stdout).toContain('greeting.txt')
    expect(fs.existsSync(outputPath)).toBe(true)
    expect(fs.readFileSync(outputPath, 'utf-8')).toBe(content)
  })

  it('download by dir/filename writes the file', async () => {
    const content = Buffer.from('binary\x00payload\x01here', 'utf-8')
    const file = ctx.createTempFile('photo.bin', content)
    await ctx.sia('mkdir', 'media')
    await ctx.sia('add', file, '--dir', 'media')

    const outputPath = path.join(ctx.dataDir, 'recovered.bin')
    const r = await ctx.sia('download', 'media/photo.bin', '--output', outputPath)

    expect(r.exitCode).toBe(0)
    expect(fs.existsSync(outputPath)).toBe(true)
    expect(fs.readFileSync(outputPath).equals(content)).toBe(true)
  })

  it('download fails clearly when the file does not exist', async () => {
    const r = await ctx.sia('download', 'does-not-exist.txt', '--output', '/tmp/nope')
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toContain('File not found')
  })
})
