jest.setTimeout(60_000)
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { createE2eContext } from './helpers'

let ctx: ReturnType<typeof createE2eContext>
let fixtureDir: string

function createFixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-import-fixture-'))

  // project-a/v1.0/release.zip, notes.txt
  fs.mkdirSync(path.join(dir, 'project-a', 'v1.0'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'project-a', 'v1.0', 'release.zip'), Buffer.alloc(256, 'a'))
  fs.writeFileSync(path.join(dir, 'project-a', 'v1.0', 'notes.txt'), 'Release notes for v1.0')

  // project-a/v2.0/release.zip
  fs.mkdirSync(path.join(dir, 'project-a', 'v2.0'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'project-a', 'v2.0', 'release.zip'), Buffer.alloc(512, 'b'))

  // project-b/build.bin
  fs.mkdirSync(path.join(dir, 'project-b'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'project-b', 'build.bin'), Buffer.alloc(128, 'c'))

  return dir
}

beforeEach(async () => {
  ctx = createE2eContext()
  await ctx.sia('connect')
  fixtureDir = createFixture()
})

afterEach(async () => {
  await ctx.stopDaemon().catch(() => {})
  ctx.cleanup()
  fs.rmSync(fixtureDir, { recursive: true, force: true })
})

describe('import command', () => {
  it('imports all files preserving directory structure', async () => {
    const r = await ctx.sia('import', fixtureDir)
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('Imported 4 files')
    expect(r.stdout).toContain('release.zip')
    expect(r.stdout).toContain('notes.txt')
    expect(r.stdout).toContain('build.bin')
  })

  it('directories appear in ls after import', async () => {
    const basename = path.basename(fixtureDir)
    const importResult = await ctx.sia('import', fixtureDir)
    expect(importResult.exitCode).toBe(0)

    // Wait for daemon to finish starting (auto-started by import)
    await new Promise((r) => setTimeout(r, 2000))

    const r = await ctx.sia('ls')
    expect(r.stdout).toContain(basename)
  })

  it('nested files appear in ls subdir', async () => {
    const basename = path.basename(fixtureDir)
    await ctx.sia('import', fixtureDir)

    const r = await ctx.sia('ls', `${basename}/project-a/v1.0`)
    expect(r.stdout).toContain('release.zip')
    expect(r.stdout).toContain('notes.txt')
  })

  it('custom remote dir name', async () => {
    const importResult = await ctx.sia('import', fixtureDir, 'releases')
    expect(importResult.exitCode).toBe(0)

    await new Promise((r) => setTimeout(r, 2000))

    const r = await ctx.sia('ls')
    expect(r.stdout).toContain('releases')
  })

  it('--dry-run shows files without importing', async () => {
    const r = await ctx.sia('import', '--dry-run', fixtureDir)
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('Would import 4 files')
    expect(r.stdout).toContain('release.zip')

    const ls = await ctx.sia('ls')
    expect(ls.stdout).not.toContain(path.basename(fixtureDir))
  })

  it('--skip-existing skips duplicates on second import', async () => {
    await ctx.sia('import', fixtureDir, 'first')

    const r = await ctx.sia('import', '--skip-existing', fixtureDir, 'second')
    expect(r.stdout).toContain('skipped')
    expect(r.stdout).toContain('Imported 0 files')
    expect(r.stdout).toContain('skipped 4')
  })

  it('errors on non-directory path', async () => {
    const filePath = ctx.createTempFile('single.txt', 'not a dir')
    const r = await ctx.sia('import', filePath)
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toContain('Not a directory')
  })

  it('errors on non-existent path', async () => {
    const r = await ctx.sia('import', '/tmp/does-not-exist-' + Date.now())
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toContain('Path not found')
  })
})
