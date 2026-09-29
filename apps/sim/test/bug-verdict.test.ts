import { describe, expect, test } from 'bun:test'
import { bugVerdict } from '../src/run'

const steady = { steady: true, intermittent: false, showsAs: ['the sheet closed'] }

describe('bugVerdict', () => {
  test('a failure the known bug shows as is KNOWN_BUG', () => {
    expect(bugVerdict('FAIL', { ...steady, failures: ['the sheet closed after one tap'] })).toEqual(
      { verdict: 'KNOWN_BUG', unexplained: [] },
    )
  })

  test('another failure beside the bug keeps the run FAIL and is named', () => {
    expect(
      bugVerdict('FAIL', {
        ...steady,
        failures: ['the sheet closed after one tap', 'one pinned object per file'],
      }),
    ).toEqual({ verdict: 'FAIL', unexplained: ['one pinned object per file'] })
  })

  test('a timeout the bug does not show as keeps the run FAIL', () => {
    const failures = [
      'Error: Timed out after 15000ms waiting for an element matching {"label":"Menu"}',
    ]
    expect(bugVerdict('FAIL', { ...steady, failures }).verdict).toBe('FAIL')
  })

  test('a pass is FIXED under a steady bug and PASS under an intermittent one', () => {
    expect(bugVerdict('PASS', { ...steady, failures: [] }).verdict).toBe('FIXED')
    expect(
      bugVerdict('PASS', { ...steady, steady: false, intermittent: true, failures: [] }).verdict,
    ).toBe('PASS')
  })

  test('an error is left alone, since the scenario never tested the bug', () => {
    expect(bugVerdict('ERROR', { ...steady, failures: ['x'] }).verdict).toBe('ERROR')
  })
})
