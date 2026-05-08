import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { createTestApp } from '../helpers'
import { watchWorker, getWatchRules, setWatchRules, type WatchRule } from '../../src/watch/service'
import type { CliApp } from '../../src/app'

let tempDir: string
let watchDir: string
let app: CliApp

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-watch-service-'))
  watchDir = path.join(tempDir, 'screenshots')
  fs.mkdirSync(watchDir)
  app = await createTestApp(tempDir)
})

afterEach(() => {
  app.db.close?.()
  fs.rmSync(tempDir, { recursive: true, force: true })
})

const signal = new AbortController().signal

describe('watchWorker', () => {
  it('does nothing with no watch rules', async () => {
    await watchWorker(app, signal)
    // No errors, no files ingested
    const files = await app.service.files.query({ limit: 100, order: 'DESC' })
    expect(files).toHaveLength(0)
  })

  it('ingests new files from watched directory', async () => {
    fs.writeFileSync(path.join(watchDir, 'test.txt'), 'hello world')

    await setWatchRules(app, [{ source: watchDir, targetDir: 'screenshots' }])
    await watchWorker(app, signal)

    const files = await app.service.files.query({ limit: 100, order: 'DESC' })
    expect(files).toHaveLength(1)
    expect(files[0].name).toBe('test.txt')
  })

  it('skips already-ingested files (dedup by hash)', async () => {
    fs.writeFileSync(path.join(watchDir, 'test.txt'), 'hello world')

    await setWatchRules(app, [{ source: watchDir, targetDir: 'screenshots' }])
    await watchWorker(app, signal)
    await watchWorker(app, signal)

    const files = await app.service.files.query({ limit: 100, order: 'DESC' })
    expect(files).toHaveLength(1)
  })

  it('applies pattern filter', async () => {
    fs.writeFileSync(path.join(watchDir, 'Screenshot 2026-04-14 at 2.30.22 PM.png'), 'png data')
    fs.writeFileSync(path.join(watchDir, 'notes.txt'), 'text data')

    await setWatchRules(app, [
      { source: watchDir, targetDir: 'screenshots', pattern: 'Screenshot*.png' },
    ])
    await watchWorker(app, signal)

    const files = await app.service.files.query({ limit: 100, order: 'DESC' })
    expect(files).toHaveLength(1)
  })

  it('renames screenshot files when rename is enabled', async () => {
    fs.writeFileSync(path.join(watchDir, 'Screenshot 2026-04-14 at 2.30.22 PM.png'), 'png data')

    await setWatchRules(app, [
      { source: watchDir, targetDir: 'screenshots', pattern: 'Screenshot*.png', appendId: true },
    ])
    await watchWorker(app, signal)

    const files = await app.service.files.query({ limit: 100, order: 'DESC' })
    expect(files).toHaveLength(1)
    expect(files[0].name).toMatch(/^screenshot-2026-04-14-143022-[A-Za-z0-9]{6}\.png$/)
  })

  it('keeps original names for non-screenshot files even with rename enabled', async () => {
    fs.writeFileSync(path.join(watchDir, 'document.pdf'), 'pdf data')

    await setWatchRules(app, [{ source: watchDir, targetDir: 'docs', appendId: true }])
    await watchWorker(app, signal)

    const files = await app.service.files.query({ limit: 100, order: 'DESC' })
    expect(files).toHaveLength(1)
    expect(files[0].name).toBe('document.pdf')
  })

  it('skips directories in watched folder', async () => {
    fs.mkdirSync(path.join(watchDir, 'subdir'))

    await setWatchRules(app, [{ source: watchDir, targetDir: 'screenshots' }])
    await watchWorker(app, signal)

    const files = await app.service.files.query({ limit: 100, order: 'DESC' })
    expect(files).toHaveLength(0)
  })
})

describe('getWatchRules / setWatchRules', () => {
  it('returns empty array when no rules set', async () => {
    const rules = await getWatchRules(app)
    expect(rules).toEqual([])
  })

  it('persists and retrieves rules', async () => {
    const rules: WatchRule[] = [
      { source: '/tmp/screenshots', targetDir: 'screenshots', pattern: '*.png', appendId: true },
    ]
    await setWatchRules(app, rules)
    const loaded = await getWatchRules(app)
    expect(loaded).toEqual(rules)
  })
})
