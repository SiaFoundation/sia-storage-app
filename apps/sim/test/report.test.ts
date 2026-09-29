import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  failureLine,
  progressOf,
  type ScenarioResult,
  writeProgress,
  writeReport,
} from '../src/report'

const result = (overrides: Partial<ScenarioResult>): ScenarioResult => ({
  file: 'apps/sim/scenarios/sync/example.scenario.ts',
  name: 'sync/example',
  description: '',
  verdict: 'PASS',
  ms: 1,
  steps: [],
  checks: [],
  notes: [],
  ...overrides,
})

describe('failureLine', () => {
  test('a FAIL gives its first failed check with the detail', () => {
    const r = result({
      verdict: 'FAIL',
      checks: [
        { label: 'uploaded', ok: true },
        { label: 'laptop has the file', ok: false, detail: 'missing a.txt' },
        { label: 'hashes match', ok: false, detail: 'b.txt differs' },
      ],
    })
    expect(failureLine(r)).toBe('laptop has the file: missing a.txt')
  })

  test('a FAIL with every check passing gives the first line of its error', () => {
    const r = result({
      verdict: 'FAIL',
      checks: [{ label: 'uploaded', ok: true }],
      error: 'AppTimeout: the file to sync took over 60000ms\n    at waitForApp (wait.ts:10)',
    })
    expect(failureLine(r)).toBe('AppTimeout: the file to sync took over 60000ms')
  })

  test('an ERROR gives the first line of its error', () => {
    const r = result({
      verdict: 'ERROR',
      error: '\nError: the devices to start took over 900000ms\n    at withDeadline (run.ts:348)',
    })
    expect(failureLine(r)).toBe('Error: the devices to start took over 900000ms')
  })

  test('a FIXED names the known bug that did not reproduce', () => {
    const r = result({ verdict: 'FIXED', knownBug: 'renames are lost offline' })
    expect(failureLine(r)).toBe('the known bug did not reproduce: renames are lost offline')
  })

  test('PASS, KNOWN_BUG and SKIP give nothing', () => {
    const failed = [{ label: 'x', ok: false }]
    expect(failureLine(result({ verdict: 'PASS' }))).toBeUndefined()
    expect(
      failureLine(result({ verdict: 'KNOWN_BUG', knownBug: 'bug', checks: failed })),
    ).toBeUndefined()
    expect(failureLine(result({ verdict: 'SKIP', notes: ['off macOS'] }))).toBeUndefined()
  })

  test('a line longer than the limit is cut to it', () => {
    const line = failureLine(result({ verdict: 'ERROR', error: 'x'.repeat(500) }))
    expect(line).toHaveLength(300)
    expect(line?.endsWith('...')).toBe(true)
  })
})

describe('progressOf', () => {
  test('counts each verdict and gives the latest with its failure line', () => {
    const results = [
      result({ verdict: 'PASS', name: 'a' }),
      result({ verdict: 'ERROR', name: 'b', error: 'Error: no emulator\n    at x' }),
      result({ verdict: 'KNOWN_BUG', name: 'c' }),
      result({ verdict: 'FIXED', name: 'd', knownBug: 'bug' }),
      result({ verdict: 'SKIP', name: 'e' }),
      result({ verdict: 'FAIL', name: 'f', checks: [{ label: 'agree', ok: false }] }),
    ]
    expect(progressOf(9, results, ['g', 'h'], results[1])).toEqual({
      total: 9,
      done: 6,
      passed: 1,
      failed: 1,
      errored: 1,
      knownBug: 1,
      fixed: 1,
      skipped: 1,
      running: ['g', 'h'],
      latest: { verdict: 'ERROR', name: 'b', reason: 'Error: no emulator' },
    })
  })

  test('a passed latest has no reason, and none gives a null latest', () => {
    const pass = result({ verdict: 'PASS', name: 'a' })
    expect(progressOf(1, [pass], [], pass).latest).toEqual({ verdict: 'PASS', name: 'a' })
    expect(progressOf(1, [], ['a'], undefined).latest).toBeNull()
  })
})

describe('writeProgress', () => {
  test('writes the JSON and leaves no temporary file beside it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sim-progress-'))
    try {
      const file = join(dir, 'progress.json')
      writeProgress(file, progressOf(2, [], ['a'], undefined))
      writeProgress(file, progressOf(2, [result({ name: 'a' })], [], result({ name: 'a' })))
      expect(JSON.parse(readFileSync(file, 'utf8')).done).toBe(1)
      expect(readdirSync(dir)).toEqual(['progress.json'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('writeReport', () => {
  test('labels an intermittent known bug as one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sim-report-'))
    try {
      const { md } = writeReport(dir, {
        runId: 'r',
        commit: 'c',
        dirty: false,
        startedAt: '2026-10-02T00:00:00.000Z',
        ms: 1,
        results: [result({ verdict: 'KNOWN_BUG', knownBug: 'a race', intermittent: true })],
      })
      expect(readFileSync(md, 'utf8')).toContain('Intermittent known bug: a race')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('lists each crash a relaunch got past under its scenario', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sim-report-'))
    try {
      const { md } = writeReport(dir, {
        runId: 'r',
        commit: 'c',
        dirty: false,
        startedAt: '2026-10-01T00:00:00.000Z',
        ms: 1,
        results: [result({ startCrashes: ['phone: Fatal signal 11 (SIGSEGV)'] })],
      })
      expect(readFileSync(md, 'utf8')).toContain(
        'Crashed while starting and was relaunched: phone: Fatal signal 11 (SIGSEGV)',
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
