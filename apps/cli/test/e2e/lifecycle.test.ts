jest.setTimeout(60_000)
import { createE2eContext } from './helpers'

let ctx: ReturnType<typeof createE2eContext>

beforeEach(() => {
  ctx = createE2eContext()
})

afterEach(async () => {
  await ctx.stopDaemon().catch(() => {})
  ctx.cleanup()
}, 15_000)

describe('CLI basics', () => {
  it('shows branding and daemon status with no args', async () => {
    const r = await ctx.sia()
    expect(r.stdout).toContain('Sia Storage CLI')
    expect(r.stdout).toContain('Daemon:')
    expect(r.stdout).toContain('stopped')
  })

  it('--help lists all commands', async () => {
    const r = await ctx.sia('--help')
    expect(r.stdout).toContain('connect')
    expect(r.stdout).toContain('daemon')
    expect(r.stdout).toContain('upload')
    expect(r.stdout).toContain('ls')
    expect(r.stdout).toContain('rm')
    expect(r.stdout).toContain('info')
  })

  it('--version prints version', async () => {
    const r = await ctx.sia('--version')
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/)
  })
})

describe('daemon lifecycle', () => {
  beforeEach(async () => {
    await ctx.sia('connect')
  })

  it('daemon start and status', async () => {
    await ctx.startDaemon()
    const r = await ctx.sia('daemon', 'status')
    expect(r.stdout).toContain('running')
    expect(r.stdout).toMatch(/PID/)
  })

  it('daemon start when already running says so', async () => {
    await ctx.startDaemon()
    const r = await ctx.sia('daemon', 'start')
    expect(r.stdout).toContain('already running')
  })

  it('daemon stop', async () => {
    await ctx.startDaemon()
    const r = await ctx.sia('daemon', 'stop')
    expect(r.stdout).toContain('stopped')
  })

  it('daemon stop when not running', async () => {
    const r = await ctx.sia('daemon', 'stop')
    expect(r.stdout).toContain('not running')
  })

  it('logs shows output after daemon start', async () => {
    await ctx.startDaemon()
    await new Promise((r) => setTimeout(r, 500))
    const r = await ctx.sia('logs', '-n', '5')
    expect(r.stdout.length).toBeGreaterThan(0)
  })
})

describe('daemon auto-start', () => {
  beforeEach(async () => {
    await ctx.sia('connect')
  })

  it('ls auto-starts daemon', async () => {
    const r = await ctx.sia('ls')
    expect(r.exitCode).toBe(0)

    const status = await ctx.sia('daemon', 'status')
    expect(status.stdout).toContain('running')
  })

  it('mkdir auto-starts daemon', async () => {
    const r = await ctx.sia('mkdir', 'test-dir')
    expect(r.exitCode).toBe(0)

    const status = await ctx.sia('daemon', 'status')
    expect(status.stdout).toContain('running')
  })

  it('status auto-starts daemon and shows running', async () => {
    const r = await ctx.sia('status')
    expect(r.stdout).toContain('running')
    expect(r.stdout).toContain('Library')
  })
})
