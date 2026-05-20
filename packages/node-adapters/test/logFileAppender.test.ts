import type { LogEntry } from '@siastorage/logger'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { createNodeFileLogAppender } from '../src/logFileAppender'

function entry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    timestamp: '2026-01-01 00:00:00.000',
    level: 'info',
    scope: 'test',
    message: 'hello',
    ...overrides,
  }
}

describe('createNodeFileLogAppender', () => {
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-log-appender-'))
  })

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('writes each entry immediately when batchMs is 0', () => {
    const filePath = path.join(tmp, 'logs', 'daemon.log')
    const a = createNodeFileLogAppender(filePath)
    a.write(entry({ message: 'one' }))
    a.write(entry({ message: 'two' }))
    const contents = fs.readFileSync(filePath, 'utf8')
    expect(contents).toContain('one')
    expect(contents).toContain('two')
    expect(contents.split('\n').filter(Boolean)).toHaveLength(2)
  })

  it('creates the parent directory lazily on first write', () => {
    const filePath = path.join(tmp, 'nested', 'a', 'b', 'log.txt')
    expect(fs.existsSync(path.dirname(filePath))).toBe(false)
    const a = createNodeFileLogAppender(filePath)
    a.write(entry())
    expect(fs.existsSync(filePath)).toBe(true)
  })

  it('coalesces writes on the batch timer when batchMs > 0', () => {
    jest.useFakeTimers()
    const filePath = path.join(tmp, 'batched.log')
    const a = createNodeFileLogAppender(filePath, { batchMs: 50 })

    a.write(entry({ message: 'a' }))
    a.write(entry({ message: 'b' }))
    expect(fs.existsSync(filePath)).toBe(false)

    jest.advanceTimersByTime(50)
    const contents = fs.readFileSync(filePath, 'utf8')
    expect(contents).toContain('a')
    expect(contents).toContain('b')
    jest.useRealTimers()
  })

  it('flush() drains the queued batch synchronously', () => {
    jest.useFakeTimers()
    const filePath = path.join(tmp, 'flush.log')
    const a = createNodeFileLogAppender(filePath, { batchMs: 1000 })
    a.write(entry({ message: 'queued' }))
    expect(fs.existsSync(filePath)).toBe(false)

    a.flush?.()
    expect(fs.readFileSync(filePath, 'utf8')).toContain('queued')
    jest.useRealTimers()
  })

  it('stop() drains and clears the timer', () => {
    jest.useFakeTimers()
    const filePath = path.join(tmp, 'stop.log')
    const a = createNodeFileLogAppender(filePath, { batchMs: 1000 })
    a.write(entry({ message: 'pending' }))

    a.stop?.()
    expect(fs.readFileSync(filePath, 'utf8')).toContain('pending')

    // After stop, advancing time should not cause another write attempt
    // (no pending timer remains).
    jest.advanceTimersByTime(2000)
    expect(fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean)).toHaveLength(1)
    jest.useRealTimers()
  })

  it('appends to an existing file across multiple write calls', () => {
    const filePath = path.join(tmp, 'append.log')
    fs.writeFileSync(filePath, 'preexisting\n')
    const a = createNodeFileLogAppender(filePath)
    a.write(entry({ message: 'new' }))
    const contents = fs.readFileSync(filePath, 'utf8')
    expect(contents.startsWith('preexisting\n')).toBe(true)
    expect(contents).toContain('new')
  })
})
