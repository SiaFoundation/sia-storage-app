import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

/*
 * Covers how the app runs the provider process: what it starts it with, when
 * it reports the folder mounted, and what quitting and signing out do to it.
 * The provider itself is stood in for by a script that prints `ready` and
 * ends when its standard input closes, as the real one does, and that
 * records the arguments of each run. Electron is mocked, since loading the
 * real module needs its binary, and the data directory is a temporary one.
 * The package's test script runs this file in a bun process of its own, for
 * the reason `updates.test.ts` gives.
 */
const appDir = mkdtempSync(join(tmpdir(), 'win32-test-'))
const dataDir = join(appDir, 'data')
const runs = join(appDir, 'runs.log')
const providerDir = join(appDir, 'native', 'windows', 'provider')
mkdirSync(providerDir, { recursive: true })
mkdirSync(dataDir)
afterAll(() => rmSync(appDir, { recursive: true, force: true }))

/** A file a test creates to have the stand-in's `serve` or `remove` fail. */
const fails = (mode: 'serve' | 'remove') => join(appDir, `${mode}-fails`)
/**
 * A file a test creates to have `serve` exit once after it is ready, never
 * say it is, say it in two pieces, or find the folder taken by one of the
 * user's own.
 */
const serve = (how: 'dies' | 'silent' | 'split' | 'taken') => join(appDir, `serve-${how}`)
writeFileSync(
  join(providerDir, 'main.ts'),
  `import { appendFileSync, existsSync, rmSync } from 'node:fs'
const [mode, ...args] = process.argv.slice(2)
appendFileSync(${JSON.stringify(runs)}, JSON.stringify({ mode, args, socket: process.env.SIA_PROVIDER_SOCKET }) + '\\n')
if (existsSync(${JSON.stringify(appDir)} + '/' + mode + '-fails')) process.exit(3)
if (mode === 'remove') process.exit(0)
if (existsSync(${JSON.stringify(appDir)} + '/serve-taken')) {
  process.stdout.write('taken\\n')
  process.exit(1)
}
// Exits once after it is ready, as a provider that crashed does.
if (existsSync(${JSON.stringify(appDir)} + '/serve-dies')) {
  rmSync(${JSON.stringify(appDir)} + '/serve-dies')
  setTimeout(() => process.exit(4), 20)
}
process.stdin.on('close', () => {
  appendFileSync(${JSON.stringify(runs)}, JSON.stringify({ mode: 'stopped' }) + '\\n')
  process.exit(0)
})
process.stdin.resume()
if (existsSync(${JSON.stringify(appDir)} + '/serve-split')) {
  process.stdout.write('rea')
  setTimeout(() => process.stdout.write('dy\\n'), 20)
} else if (!existsSync(${JSON.stringify(appDir)} + '/serve-silent')) process.stdout.write('ready\\n')
`,
)

mock.module('electron', () => ({
  app: { getAppPath: () => appDir, getName: () => 'test' },
  nativeImage: {},
  nativeTheme: {},
}))
process.env.SIA_DATA_DIR = dataDir

const { createWindowsIntegration } = await import('./win32')

const config = {
  shellSocket: join(dataDir, 'provider.sock'),
  runtime: process.execPath,
  domainId: 'sia-dev',
  displayName: 'Sia Storage Dev',
}
const folder = join(homedir(), 'Sia Storage Dev')
const recorded = () =>
  readFileSync(runs, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { mode: string; args?: string[]; socket?: string })

describe('the Windows folder provider, as the app runs it', () => {
  beforeEach(() => {
    writeFileSync(runs, '')
    for (const flag of [
      fails('serve'),
      fails('remove'),
      serve('dies'),
      serve('silent'),
      serve('split'),
      serve('taken'),
    ]) {
      rmSync(flag, { force: true })
    }
  })

  it('starts the provider on the folder in the home directory and is mounted once it says ready', async () => {
    const platform = createWindowsIntegration()
    expect(platform.status()).toBe('absent')
    expect(platform.mount()).toBeNull()

    await platform.start(config)

    expect(platform.status()).toBe('mounted')
    expect(platform.mountPath()).toBe(folder)
    expect(platform.mount()).toEqual({ id: 'sia-dev' })
    const [run] = recorded()
    expect(run.mode).toBe('serve')
    expect(run.args?.slice(0, 3)).toEqual([folder, 'sia-dev', 'Sia Storage Dev'])
    expect(run.socket).toBe(join(dataDir, 'provider.sock'))
    await platform.stop()
  })

  it('stops the provider on quit by closing its input, and leaves the folder registered', async () => {
    const platform = createWindowsIntegration()
    await platform.start(config)

    await platform.stop()

    expect(platform.status()).toBe('absent')
    expect(platform.mountPath()).toBeNull()
    expect(recorded().map((r) => r.mode)).toEqual(['serve', 'stopped'])
  })

  it('removes the folder on sign-out, after the provider has stopped', async () => {
    const platform = createWindowsIntegration()
    await platform.start(config)

    await platform.stop({ remove: true })

    expect(platform.status()).toBe('absent')
    expect(recorded().map((r) => r.mode)).toEqual(['serve', 'stopped', 'remove'])
    expect(recorded()[2].args).toEqual([folder, 'sia-dev'])
  })

  it('removes a folder it is not serving when discarding it before a reset', async () => {
    expect(await createWindowsIntegration().discard(config)).toBe(true)
    expect(recorded().map((r) => r.mode)).toEqual(['remove'])
  })

  it('does not report the mount gone when removing the folder fails, so the wipe is held', async () => {
    writeFileSync(fails('remove'), '')
    const platform = createWindowsIntegration()
    await platform.start(config)

    await platform.stop({ remove: true })

    expect(platform.status()).toBe('error')
  })

  it('reports an error when the provider exits before it is ready', async () => {
    writeFileSync(fails('serve'), '')
    const platform = createWindowsIntegration()

    await platform.start(config)

    expect(platform.status()).toBe('error')
    expect(platform.mount()).toEqual({ id: 'sia-dev' })
    expect(existsSync(join(dataDir, 'provider.log'))).toBe(true)
    await platform.stop()
  })

  it('starts the provider again when it exits after it was ready', async () => {
    writeFileSync(serve('dies'), '')
    const platform = createWindowsIntegration({ restartMs: 10 })
    await platform.start(config)

    const served = () => recorded().filter((r) => r.mode === 'serve').length
    for (let waited = 0; waited < 5_000 && !(served() === 2 && platform.status() === 'mounted');) {
      await new Promise((resolve) => setTimeout(resolve, (waited += 10) && 10))
    }

    expect(served()).toBe(2)
    expect(platform.status()).toBe('mounted')
    await platform.stop()
    expect(platform.status()).toBe('absent')
  })

  it('is mounted when the provider says ready in two pieces', async () => {
    writeFileSync(serve('split'), '')
    const platform = createWindowsIntegration()

    await platform.start(config)

    expect(platform.status()).toBe('mounted')
    await platform.stop()
  })

  it("does not start the provider again when the folder is one of the user's own", async () => {
    writeFileSync(serve('taken'), '')
    const platform = createWindowsIntegration({ restartMs: 10 })

    await platform.start(config)
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(platform.status()).toBe('error')
    expect(recorded().map((r) => r.mode)).toEqual(['serve'])
    await platform.stop()
  })

  it('does not start the provider again once it was stopped', async () => {
    writeFileSync(fails('serve'), '')
    const platform = createWindowsIntegration({ restartMs: 10 })
    await platform.start(config)

    await platform.stop()
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(recorded().map((r) => r.mode)).toEqual(['serve'])
  })

  it('is still starting when the provider has not said it is ready in time, and names the mount for the daemon to record', async () => {
    writeFileSync(serve('silent'), '')
    const platform = createWindowsIntegration({ readyMs: 50 })

    await platform.start(config)

    expect(platform.status()).toBe('starting')
    expect(platform.mountPath()).toBeNull()
    expect(platform.mount()).toEqual({ id: 'sia-dev' })
    await platform.stop()
  })
})
