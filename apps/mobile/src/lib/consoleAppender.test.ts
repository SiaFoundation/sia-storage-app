jest.unmock('@siastorage/logger')

import { createConsoleAppender, type LogEntry } from '@siastorage/logger'

const ESC = String.fromCharCode(0x1b)

function entry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    timestamp: '2026-01-01 00:00:00.000',
    level: 'info',
    scope: 'test',
    message: 'hello',
    ...overrides,
  }
}

describe('createConsoleAppender', () => {
  let logSpy: jest.SpyInstance
  const origLevel = process.env.EXPO_PUBLIC_LOG_LEVEL
  const origScopes = process.env.EXPO_PUBLIC_LOG_SCOPES

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    if (origLevel === undefined) delete process.env.EXPO_PUBLIC_LOG_LEVEL
    else process.env.EXPO_PUBLIC_LOG_LEVEL = origLevel
    if (origScopes === undefined) delete process.env.EXPO_PUBLIC_LOG_SCOPES
    else process.env.EXPO_PUBLIC_LOG_SCOPES = origScopes
  })

  it('writes via console.log by default', () => {
    const a = createConsoleAppender()
    a.write(entry({ message: 'hi' }))
    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(String(logSpy.mock.calls[0][0])).toContain('hi')
  })

  it('emits ANSI escapes by default and plain text when ansi: false', () => {
    const ansi = createConsoleAppender()
    ansi.write(entry())
    expect(String(logSpy.mock.calls[0][0])).toContain(ESC)

    logSpy.mockClear()
    const plain = createConsoleAppender({ ansi: false })
    plain.write(entry())
    expect(String(logSpy.mock.calls[0][0])).not.toContain(ESC)
  })

  it('filters entries below the configured level', () => {
    const a = createConsoleAppender({ level: 'warn' })
    a.write(entry({ level: 'debug' }))
    a.write(entry({ level: 'info' }))
    a.write(entry({ level: 'warn', message: 'w' }))
    a.write(entry({ level: 'error', message: 'e' }))
    const messages = logSpy.mock.calls.map((c) => String(c[0]))
    expect(messages).toHaveLength(2)
    expect(messages[0]).toContain('w')
    expect(messages[1]).toContain('e')
  })

  it('filters by scope when scopes are configured', () => {
    const a = createConsoleAppender({ scopes: ['kept'] })
    a.write(entry({ scope: 'dropped' }))
    a.write(entry({ scope: 'kept', message: 'keep-me' }))
    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(String(logSpy.mock.calls[0][0])).toContain('keep-me')
  })

  it('reads EXPO_PUBLIC_LOG_LEVEL once at factory time', () => {
    process.env.EXPO_PUBLIC_LOG_LEVEL = 'error'
    const a = createConsoleAppender()
    a.write(entry({ level: 'info' }))
    expect(logSpy).not.toHaveBeenCalled()
    a.write(entry({ level: 'error', message: 'e' }))
    expect(logSpy).toHaveBeenCalledTimes(1)
  })

  it('explicit opts override env vars', () => {
    process.env.EXPO_PUBLIC_LOG_LEVEL = 'error'
    const a = createConsoleAppender({ level: 'debug' })
    a.write(entry({ level: 'info', message: 'shown' }))
    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(String(logSpy.mock.calls[0][0])).toContain('shown')
  })

  it('parses EXPO_PUBLIC_LOG_SCOPES as a comma list', () => {
    process.env.EXPO_PUBLIC_LOG_SCOPES = 'a, b ,c'
    const a = createConsoleAppender()
    a.write(entry({ scope: 'a', message: 'A' }))
    a.write(entry({ scope: 'd' }))
    a.write(entry({ scope: 'b', message: 'B' }))
    expect(logSpy.mock.calls.map((c) => String(c[0])).join('|')).toMatch(/A.*B/)
    expect(logSpy).toHaveBeenCalledTimes(2)
  })

  it('treats an invalid EXPO_PUBLIC_LOG_LEVEL as the default (debug)', () => {
    process.env.EXPO_PUBLIC_LOG_LEVEL = 'verbose'
    const a = createConsoleAppender()
    a.write(entry({ level: 'debug', message: 'dbg' }))
    expect(logSpy).toHaveBeenCalledTimes(1)
  })
})
