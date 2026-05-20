jest.unmock('@siastorage/logger')

import {
  addAppender,
  type Appender,
  clearAppenders,
  flushAllAppenders,
  type LogEntry,
  logger,
  removeAppender,
} from '@siastorage/logger'

type RecordingAppender = Appender & {
  written: LogEntry[]
  flushed: number
}

function createRecordingAppender(
  opts: { onWrite?: (entry: LogEntry) => void } = {},
): RecordingAppender {
  const written: LogEntry[] = []
  let flushed = 0
  return {
    write(entry) {
      opts.onWrite?.(entry)
      written.push(entry)
    },
    flush() {
      flushed += 1
    },
    get written() {
      return written
    },
    get flushed() {
      return flushed
    },
  } as RecordingAppender
}

describe('appender registry', () => {
  beforeEach(() => {
    clearAppenders()
  })

  it('buffers entries logged before any appender is registered and drains on add', () => {
    logger.info('test', 'before-1')
    logger.info('test', 'before-2')

    const a = createRecordingAppender()
    addAppender(a)

    expect(a.written.map((e) => e.message)).toEqual(['before-1', 'before-2'])
    // The drain calls flush() once so async appenders can persist immediately.
    expect(a.flushed).toBe(1)
  })

  it('fans out each entry to every registered appender', () => {
    const a = createRecordingAppender()
    const b = createRecordingAppender()
    addAppender(a)
    addAppender(b)

    logger.warn('scope', 'broadcast')

    expect(a.written).toHaveLength(1)
    expect(b.written).toHaveLength(1)
    expect(a.written[0].message).toBe('broadcast')
    expect(b.written[0].message).toBe('broadcast')
  })

  it('a throwing appender does not stop other appenders or crash producers', () => {
    const a = createRecordingAppender({
      onWrite: () => {
        throw new Error('boom')
      },
    })
    const b = createRecordingAppender()
    addAppender(a)
    addAppender(b)

    expect(() => logger.error('scope', 'still-fires')).not.toThrow()
    expect(b.written.map((e) => e.message)).toEqual(['still-fires'])
  })

  it('removeAppender stops further writes from reaching that appender', () => {
    const a = createRecordingAppender()
    addAppender(a)
    logger.info('test', 'first')
    removeAppender(a)
    logger.info('test', 'second')

    expect(a.written.map((e) => e.message)).toEqual(['first'])
  })

  it('flushAllAppenders calls flush() on every appender', async () => {
    const a = createRecordingAppender()
    const b = createRecordingAppender()
    addAppender(a)
    addAppender(b)

    // Add drains pre-install buffer (none here) and calls flush once each;
    // baseline is 1 from that path.
    const before = { a: a.flushed, b: b.flushed }
    await flushAllAppenders()
    expect(a.flushed).toBe(before.a + 1)
    expect(b.flushed).toBe(before.b + 1)
  })

  it('clearAppenders resets both the registry and the pre-install buffer', () => {
    logger.info('test', 'orphaned')
    clearAppenders()

    const a = createRecordingAppender()
    addAppender(a)
    expect(a.written).toHaveLength(0)
  })

  it('an appender that logs from within write() does not corrupt the dispatch', () => {
    const a = createRecordingAppender({
      onWrite: (entry) => {
        if (entry.message === 'outer') {
          // Recursive logger call must not throw or duplicate the outer entry.
          logger.debug('test', 'nested')
        }
      },
    })
    addAppender(a)

    logger.info('test', 'outer')

    const messages = a.written.map((e) => e.message)
    expect(messages).toContain('outer')
    expect(messages).toContain('nested')
    // Exactly one occurrence of each — no recursive amplification.
    expect(messages.filter((m) => m === 'outer')).toHaveLength(1)
    expect(messages.filter((m) => m === 'nested')).toHaveLength(1)
  })

  it('entries logged after the last appender is removed land in the pre-install buffer', () => {
    const a = createRecordingAppender()
    addAppender(a)
    removeAppender(a)

    logger.info('test', 'after-detach')

    // The pre-install buffer is internal; the only way to assert on it is
    // to add a new appender and confirm the entry drains.
    const b = createRecordingAppender()
    addAppender(b)
    expect(b.written.map((e) => e.message)).toEqual(['after-detach'])
  })
})
