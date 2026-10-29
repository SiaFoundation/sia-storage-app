import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildComment } from './comment'
import type { StructureChange } from './structure'
import type { RunReport } from './types'

function report(structureChanges: StructureChange[]): RunReport {
  return {
    version: 1,
    mode: 'compare',
    sameCode: false,
    startedAt: '2026-11-02T00:00:00.000Z',
    durationMs: 1000,
    runner: { os: 'Linux', image: 'ubuntu26', cpu: 'cpu', cores: 4, memoryGb: 16, node: 'v24' },
    rounds: 6,
    head: { commit: 'a'.repeat(40) },
    base: { commit: 'b'.repeat(40) },
    calibratedRunner: false,
    suites: [],
    structureChanges,
    failed: true,
    failures: ['structure'],
  }
}

test('a run that changes every statement still fits in a GitHub comment', () => {
  const sql = `SELECT ${'f.column, '.repeat(40)}f.id FROM files f WHERE f.id = ?`
  const changes: StructureChange[] = Array.from({ length: 1000 }, (_, i) => ({
    suite: 'library',
    spec: `spec${i}`,
    what: 'plan',
    direction: 'changed',
    summary: 'query plan changed',
    before: [sql, '  SCAN f'],
    after: [`${sql} AND 1`, '  SEARCH f USING INDEX idx (id=?)'],
  }))
  const body = buildComment(report(changes))
  assert.ok(body.length < 65_536, `comment is ${body.length} characters`)
  assert.match(body, /more changes do not fit in a comment/)
})
