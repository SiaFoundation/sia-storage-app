import { describe, expect, test } from 'bun:test'
import { parseTop } from '../src/devices/android'
import { filterLogs, summarize } from '../src/observe'

const LOG = [
  '2026-09-29 12:04:16.608 DEBUG [importScanner] tick_complete',
  '2026-09-29 12:04:17.357 INFO  [uploader] file_added {"id":"a"}',
  '2026-09-29 12:04:17.405 WARN [uploader] slow_pack {"ms":900}',
  '2026-09-29 12:04:18.000 ERROR [syncDownEvents] sync_error',
  'a continuation line without a prefix',
].join('\n')

describe('filterLogs', () => {
  test('keeps lines at the level asked for and above', () => {
    expect(filterLogs(LOG, { level: 'warn' })).toEqual([
      '2026-09-29 12:04:17.405 WARN [uploader] slow_pack {"ms":900}',
      '2026-09-29 12:04:18.000 ERROR [syncDownEvents] sync_error',
    ])
  })

  test('keeps one scope, and matches text in any case', () => {
    expect(filterLogs(LOG, { scope: 'uploader', grep: 'SLOW' })).toEqual([
      '2026-09-29 12:04:17.405 WARN [uploader] slow_pack {"ms":900}',
    ])
  })

  test('keeps a line without a prefix only when no level or scope is asked for', () => {
    expect(filterLogs(LOG, { grep: 'continuation' })).toHaveLength(1)
    expect(filterLogs(LOG, { level: 'debug', grep: 'continuation' })).toHaveLength(0)
  })
})

describe('summarize', () => {
  test('reports percentiles that were measured, by nearest rank', () => {
    const s = summarize([5, 1, 3, 2, 4, 10, 6, 7, 8, 9])
    expect(s).toEqual({ n: 10, min: 1, p50: 5, p95: 10, max: 10, mean: 5.5 })
  })

  test('is all zeros for no values', () => {
    expect(summarize([])).toEqual({ n: 0, min: 0, p50: 0, p95: 0, max: 0, mean: 0 })
  })
})

describe('parseTop', () => {
  test('reads CPU and memory from the process line, whatever the unit', () => {
    expect(parseTop('%CPU  RES\n 12.5 210M')).toEqual({ cpu: 12.5, rssMb: 210 })
    expect(parseTop('%CPU  RES\n 3.0 1.5G')).toEqual({ cpu: 3, rssMb: 1536 })
    expect(parseTop('%CPU  RES\n 0.0 51200')).toEqual({ cpu: 0, rssMb: 50 })
  })

  test('is null when top printed no process', () => {
    expect(parseTop('%CPU  RES')).toBeNull()
  })
})
