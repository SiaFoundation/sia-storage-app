jest.unmock('@siastorage/logger')

import {
  appendLog,
  flushLogs,
  type LogEntry,
  setLogAppender,
  stopLogAppender,
} from '@siastorage/logger'

function makeEntry(msg: string): LogEntry {
  return {
    timestamp: new Date().toISOString(),
    level: 'info',
    scope: 'test',
    message: msg,
  }
}

describe('logAppender', () => {
  afterEach(async () => {
    await stopLogAppender()
  })

  it('buffers entries before appender is set', () => {
    appendLog(makeEntry('before'))
    appendLog(makeEntry('before2'))

    const received: LogEntry[] = []
    setLogAppender((entries) => {
      received.push(...entries)
    })

    expect(received).toHaveLength(2)
    expect(received[0].message).toBe('before')
    expect(received[1].message).toBe('before2')
  })

  it('flushes buffered entries when appender is registered', () => {
    appendLog(makeEntry('buffered'))

    const received: LogEntry[] = []
    setLogAppender((entries) => {
      received.push(...entries)
    })

    expect(received).toHaveLength(1)
    expect(received[0].message).toBe('buffered')
  })

  it('flushLogs writes buffered entries immediately', () => {
    const received: LogEntry[] = []
    setLogAppender((entries) => {
      received.push(...entries)
    })

    appendLog(makeEntry('manual'))
    expect(received).toHaveLength(0)

    flushLogs()
    expect(received).toHaveLength(1)
    expect(received[0].message).toBe('manual')
  })

  it('stopLogAppender flushes remaining entries then clears appender', async () => {
    const received: LogEntry[] = []
    setLogAppender((entries) => {
      received.push(...entries)
    })

    appendLog(makeEntry('final1'))
    appendLog(makeEntry('final2'))

    await stopLogAppender()

    expect(received).toHaveLength(2)
    expect(received[0].message).toBe('final1')
    expect(received[1].message).toBe('final2')

    appendLog(makeEntry('after-stop'))
    flushLogs()
    expect(received).toHaveLength(2)
  })

  it('entries buffered after stop are flushed when appender is re-registered', async () => {
    const received1: LogEntry[] = []
    setLogAppender((entries) => {
      received1.push(...entries)
    })

    await stopLogAppender()

    appendLog(makeEntry('during-suspension'))
    appendLog(makeEntry('during-suspension-2'))

    const received2: LogEntry[] = []
    setLogAppender((entries) => {
      received2.push(...entries)
    })

    expect(received2).toHaveLength(2)
    expect(received2[0].message).toBe('during-suspension')
    expect(received2[1].message).toBe('during-suspension-2')
  })

  it('preserves timestamps from when entries were created', async () => {
    const before = new Date().toISOString()
    const entry = makeEntry('timestamped')
    const after = new Date().toISOString()

    await stopLogAppender()
    appendLog(entry)

    const received: LogEntry[] = []
    setLogAppender((entries) => {
      received.push(...entries)
    })

    expect(received[0].timestamp).toBe(entry.timestamp)
    expect(received[0].timestamp >= before).toBe(true)
    expect(received[0].timestamp <= after).toBe(true)
  })

  it('multiple stop/resume cycles preserve buffer', async () => {
    const received: LogEntry[] = []

    setLogAppender((entries) => {
      received.push(...entries)
    })
    appendLog(makeEntry('cycle1'))
    await stopLogAppender()

    appendLog(makeEntry('between'))

    setLogAppender((entries) => {
      received.push(...entries)
    })
    appendLog(makeEntry('cycle2'))
    await stopLogAppender()

    appendLog(makeEntry('between2'))

    setLogAppender((entries) => {
      received.push(...entries)
    })

    expect(received.map((e) => e.message)).toEqual(['cycle1', 'between', 'cycle2', 'between2'])
  })
})
