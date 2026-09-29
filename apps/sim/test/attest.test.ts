import { describe, expect, test } from 'bun:test'
import {
  attestRefusal,
  attestStatus,
  parseRunSummary,
  progressDescription,
  repoFromPrUrl,
} from '../src/attest'
import type { Progress } from '../src/report'

const RUN_ID = '2026-09-30T17-02-11-123Z-a1b2'

describe('parseRunSummary', () => {
  test('reads every count from the last summary line', () => {
    const output = [
      'PASS      a scenario (3/3 checks, 12.0s)',
      `run ${RUN_ID}: 22 passed, 1 failed, 6 known bug, 2 skipped, 3 need review, 1 start crashes, 2 intermittent`,
      `report /tmp/sia-sim/runs/${RUN_ID}/report.md`,
      '',
    ].join('\n')
    expect(parseRunSummary(output)).toEqual({
      runId: RUN_ID,
      counts:
        '22 passed, 1 failed, 6 known bug, 2 skipped, 3 need review, 1 start crashes, 2 intermittent',
      passed: 22,
      failed: 1,
      knownBug: 6,
      skipped: 2,
      needReview: 3,
      startCrashes: 1,
    })
  })

  test('counts a part the line leaves out as zero', () => {
    expect(parseRunSummary(`run ${RUN_ID}: 4 passed, 0 failed\n`)).toMatchObject({
      passed: 4,
      failed: 0,
      knownBug: 0,
      skipped: 0,
      needReview: 0,
      startCrashes: 0,
    })
  })

  test('returns null when the run ended before printing a summary', () => {
    expect(parseRunSummary('PASS      a scenario (3/3 checks, 12.0s)\n')).toBeNull()
  })
})

describe('attestStatus', () => {
  const summary = parseRunSummary(`run ${RUN_ID}: 22 passed, 0 failed, 6 known bug`)

  test('a run that exits 0 posts success with its counts and run id', () => {
    expect(attestStatus(0, summary)).toEqual({
      state: 'success',
      description: `Local: 22 passed, 0 failed, 6 known bug (run ${RUN_ID})`,
    })
  })

  test('a run that exits 1 posts failure', () => {
    const failed = parseRunSummary(`run ${RUN_ID}: 21 passed, 1 failed`)
    expect(attestStatus(1, failed)).toEqual({
      state: 'failure',
      description: `Local: 21 passed, 1 failed (run ${RUN_ID})`,
    })
  })

  test('a run with no summary posts failure with its exit code', () => {
    expect(attestStatus(2, null)).toEqual({
      state: 'failure',
      description: 'Local: the run exited 2 before printing its summary',
    })
  })

  test('an interrupted run posts nothing', () => {
    expect(attestStatus(130, summary)).toHaveProperty('refused')
  })

  test('a run that skipped a scenario posts nothing, even when it exits 0', () => {
    const skipped = parseRunSummary(`run ${RUN_ID}: 20 passed, 0 failed, 2 skipped`)
    expect(attestStatus(0, skipped)).toHaveProperty('refused')
  })

  test('keeps the description within the 140 characters GitHub accepts', () => {
    const long = parseRunSummary(`run ${'x'.repeat(200)}: 1 passed, 0 failed`)
    const status = attestStatus(0, long)
    if ('refused' in status) throw new Error('expected a status')
    expect(status.description).toHaveLength(140)
  })
})

describe('attestRefusal', () => {
  const pr = { number: 888, headRefOid: 'a'.repeat(40) }

  test('a clean tree at the PR head can post', () => {
    expect(attestRefusal({ uncommitted: '', localHead: pr.headRefOid, pr })).toBeNull()
  })

  test('refuses a tree with changes to tracked files', () => {
    expect(
      attestRefusal({ uncommitted: ' M apps/sim/src/cli.ts\n', localHead: pr.headRefOid, pr }),
    ).toContain('uncommitted changes')
  })

  test('refuses a branch with no pull request', () => {
    expect(attestRefusal({ uncommitted: '', localHead: pr.headRefOid, pr: null })).toContain(
      'no pull request',
    )
  })

  test('refuses a local commit that is not the PR head, naming both', () => {
    const refusal = attestRefusal({ uncommitted: '', localHead: 'b'.repeat(40), pr })
    expect(refusal).toContain('bbbbbbbbb')
    expect(refusal).toContain('aaaaaaaaa')
    expect(refusal).toContain('#888')
  })
})

test('repoFromPrUrl reads owner and repo from a pull request URL', () => {
  expect(repoFromPrUrl('https://github.com/SiaFoundation/sia-storage-app/pull/888')).toBe(
    'SiaFoundation/sia-storage-app',
  )
})

describe('progressDescription', () => {
  const progress = (latest: Progress['latest']): Progress => ({
    total: 22,
    done: 5,
    passed: 3,
    failed: 1,
    errored: 0,
    knownBug: 1,
    fixed: 0,
    skipped: 0,
    running: ['x'],
    latest,
  })

  test('gives the counts that are not zero and the latest failure before its name', () => {
    expect(
      progressDescription(progress({ verdict: 'FAIL', name: 'sync/a', reason: 'agree: 2 != 3' })),
    ).toBe('5/22 done, 3 passed, 1 failed, 1 known bug. Last FAIL: agree: 2 != 3 (sync/a)')
  })

  test('names a latest pass, and gives no latest before the first result', () => {
    expect(progressDescription(progress({ verdict: 'PASS', name: 'sync/a' }))).toBe(
      '5/22 done, 3 passed, 1 failed, 1 known bug. Last PASS: sync/a',
    )
    expect(progressDescription(progress(null))).toBe('5/22 done, 3 passed, 1 failed, 1 known bug.')
  })

  test('fits the 140 characters GitHub allows', () => {
    const long = progress({ verdict: 'ERROR', name: 'n', reason: 'x'.repeat(300) })
    expect(progressDescription(long)).toHaveLength(140)
  })
})
