import { describe, expect, test } from 'bun:test'
import { bugVerdict } from '../src/run'
import { type BugCheck, type CheckRecord, defineScenario } from '../src/scenario'

const shape: BugCheck[] = [
  { check: 'stores it as image/dng', got: 'image/tiff' },
  'the laptop has the DNG',
]
const bugChecks: CheckRecord[] = [
  { label: 'stores it as image/dng', ok: false, actual: 'image/tiff' },
  { label: 'the laptop has the DNG', ok: false },
  { label: 'the phone has the DNG', ok: true },
]
const steady = { steady: true, intermittent: false, shape }

describe('bugVerdict', () => {
  test('a run failing exactly the checks the bug lists is KNOWN_BUG', () => {
    expect(bugVerdict('FAIL', { ...steady, checks: bugChecks })).toEqual({
      verdict: 'KNOWN_BUG',
      differences: [],
    })
  })

  test('another failed check beside the bug keeps the run FAIL and is named', () => {
    const checks = [...bugChecks, { label: 'one pinned object per file', ok: false }]
    expect(bugVerdict('FAIL', { ...steady, checks })).toEqual({
      verdict: 'FAIL',
      differences: ['one pinned object per file failed'],
    })
  })

  test('a listed check that passed keeps the run FAIL', () => {
    const checks = bugChecks.map((c) =>
      c.label === 'the laptop has the DNG' ? { ...c, ok: true } : c,
    )
    expect(bugVerdict('FAIL', { ...steady, checks }).differences).toEqual([
      'the laptop has the DNG passed',
    ])
  })

  test('a listed check that saw another value than the bug gives keeps the run FAIL', () => {
    const checks = bugChecks.map((c) =>
      c.label === 'stores it as image/dng' ? { ...c, actual: 'application/octet-stream' } : c,
    )
    expect(bugVerdict('FAIL', { ...steady, checks }).differences).toEqual([
      'stores it as image/dng saw "application/octet-stream"',
    ])
  })

  test('matches decides a value that changes from run to run', () => {
    const matching = {
      ...steady,
      shape: [
        { check: 'each file is pinned once', matches: (names: string[]) => names.length > 0 },
      ],
    }
    const pinnedTwice = (actual: string[]) => [
      { label: 'each file is pinned once', ok: false, actual },
    ]
    expect(bugVerdict('FAIL', { ...matching, checks: pinnedTwice(['a.bin']) }).verdict).toBe(
      'KNOWN_BUG',
    )
    expect(bugVerdict('FAIL', { ...matching, checks: pinnedTwice([]) }).verdict).toBe('FAIL')
  })

  test('a check the bug fails on some runs only may pass, but fails only as the bug does', () => {
    const pinsSometimes: BugCheck = {
      check: 'one pinned object per file',
      matches: (n: number) => n > 8,
      sometimes: true,
    }
    const sometimes = { ...steady, shape: [...shape, pinsSometimes] }
    const pins = (actual: number) => [
      ...bugChecks,
      { label: 'one pinned object per file', ok: false, actual },
    ]
    expect(bugVerdict('FAIL', { ...sometimes, checks: bugChecks }).verdict).toBe('KNOWN_BUG')
    expect(bugVerdict('FAIL', { ...sometimes, checks: pins(13) }).verdict).toBe('KNOWN_BUG')
    expect(bugVerdict('FAIL', { ...sometimes, checks: pins(7) }).differences).toEqual([
      'one pinned object per file saw 7',
    ])
  })

  test('a run that ended on an error is FAIL even when its checks match the bug', () => {
    const error = 'AppTimeout: Timed out after 120000ms waiting for devices to converge\n  at x'
    expect(bugVerdict('FAIL', { ...steady, checks: bugChecks, error })).toEqual({
      verdict: 'FAIL',
      differences: [
        'ended on AppTimeout: Timed out after 120000ms waiting for devices to converge',
      ],
    })
  })

  test('a pass is FIXED under a steady bug and PASS under an intermittent one', () => {
    expect(bugVerdict('PASS', { ...steady, checks: [] }).verdict).toBe('FIXED')
    expect(
      bugVerdict('PASS', { ...steady, steady: false, intermittent: true, checks: [] }).verdict,
    ).toBe('PASS')
  })

  test('an ERROR is left alone, since the scenario never tested the bug', () => {
    expect(bugVerdict('ERROR', { ...steady, checks: bugChecks }).verdict).toBe('ERROR')
  })
})

describe('defineScenario', () => {
  const base = { name: 'x', description: 'x', devices: {}, run: async () => {} }

  test('refuses a bug on a platform whose checks it does not list', () => {
    expect(() =>
      defineScenario({
        ...base,
        knownBug: { ios: 'a', android: 'b' },
        bugShowsAs: { ios: ['the file is added'] },
      }),
    ).toThrow('the bug on android needs bugShowsAs')
  })

  test('refuses bugShowsAs without a bug', () => {
    expect(() => defineScenario({ ...base, bugShowsAs: ['the file is added'] })).toThrow(
      'describes no bug',
    )
  })
})
