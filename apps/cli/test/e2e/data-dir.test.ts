jest.setTimeout(60_000)
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { createE2eContext } from './helpers'

let ctx: ReturnType<typeof createE2eContext>

beforeEach(() => {
  ctx = createE2eContext()
})

afterEach(async () => {
  await ctx.stopDaemon().catch(() => {})
  ctx.cleanup()
})

describe('--data-dir flag', () => {
  it('-d flag creates and uses a custom data directory', async () => {
    const customDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-ddir-'))
    try {
      const r = await ctx.sia('-d', customDir, 'connect')
      expect(r.exitCode).toBe(0)
      expect(r.stdout).toContain('Connected successfully')
      expect(fs.existsSync(path.join(customDir, 'data.db'))).toBe(true)
    } finally {
      fs.rmSync(customDir, { recursive: true, force: true })
    }
  })

  it('two data dirs are independent', async () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-a-'))
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-b-'))
    try {
      await ctx.sia('-d', dirA, 'connect')
      await ctx.sia('-d', dirB, 'connect')

      await ctx.sia('-d', dirA, 'mkdir', 'only-in-a')

      const lsA = await ctx.sia('-d', dirA, 'ls')
      const lsB = await ctx.sia('-d', dirB, 'ls')

      expect(lsA.stdout).toContain('only-in-a')
      expect(lsB.stdout).not.toContain('only-in-a')
    } finally {
      fs.rmSync(dirA, { recursive: true, force: true })
      fs.rmSync(dirB, { recursive: true, force: true })
    }
  })

  it('--data-dir overrides SIA_DATA_DIR env var', async () => {
    const flagDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-flag-'))
    try {
      await ctx.sia('connect')
      await ctx.sia('mkdir', 'env-dir-folder')

      await ctx.sia('-d', flagDir, 'connect')
      const r = await ctx.sia('-d', flagDir, 'ls')
      expect(r.stdout).not.toContain('env-dir-folder')
    } finally {
      fs.rmSync(flagDir, { recursive: true, force: true })
    }
  })
})
