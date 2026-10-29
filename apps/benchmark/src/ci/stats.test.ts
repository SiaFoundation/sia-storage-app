import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { calibrate, compareRounds, DEFAULT_TOLERANCE, toleranceFor } from './stats'

const tol = { tolerance: 1.25, floorMs: 0.5, calibrated: true }

describe('compareRounds', () => {
  test('a spec past its tolerance and floor in every round is slower', () => {
    const c = compareRounds([20, 21, 22, 20, 21, 22], [10, 10, 11, 10, 10, 11], tol)
    assert.equal(c.verdict, 'slower')
    assert.equal(c.slowerRounds, 6)
  })

  test('a ratio past tolerance under the absolute floor is the same', () => {
    const c = compareRounds([0.2, 0.2, 0.2, 0.2], [0.1, 0.1, 0.1, 0.1], tol)
    assert.equal(c.verdict, 'same')
  })

  test('a slower median that only some rounds agree on is unsteady', () => {
    const c = compareRounds([30, 30, 30, 30, 5, 5], [10, 10, 10, 10, 10, 10], tol)
    assert.equal(c.verdict, 'unsteady')
  })

  test('rounds that read as 0 ms give a finite ratio', () => {
    const c = compareRounds([0, 0, 0], [0, 0, 0], tol)
    assert.equal(c.ratio, 1)
    assert.equal(c.verdict, 'same')
  })
})

describe('calibrate', () => {
  test('rounds that read as 0 ms give finite thresholds that survive JSON', () => {
    const spec = calibrate([{ headRounds: [0, 0, 0, 0], baseRounds: [0, 0.001, 0, 0] }], 4)
    const parsed = JSON.parse(JSON.stringify(spec))
    assert.ok(Number.isFinite(parsed.tolerance))
    assert.ok(Number.isFinite(parsed.floorMs))
  })

  test('a sample with fewer rounds than asked for is refused', () => {
    assert.throws(() => calibrate([{ headRounds: [], baseRounds: [] }], 6))
    assert.throws(() => calibrate([], 6))
  })

  test('identical sides get the minimum tolerance and floor', () => {
    const rounds = [5, 6, 5, 6, 5, 6]
    const spec = calibrate([{ headRounds: rounds, baseRounds: rounds }], 6)
    assert.equal(spec.tolerance, 1.1)
    assert.equal(spec.floorMs, 0.25)
  })

  test('the tolerance covers the largest gap any calibration run showed', () => {
    const spec = calibrate(
      [
        { headRounds: [10, 10, 10, 10], baseRounds: [10, 10, 10, 10] },
        { headRounds: [13, 13, 13, 13], baseRounds: [10, 10, 10, 10] },
      ],
      4,
    )
    assert.ok(spec.tolerance >= 1.3)
  })
})

describe('toleranceFor', () => {
  const calibrated = { medianMs: 10, tolerance: 1.12, floorMs: 0.4, runs: 5 }

  test('a run with the calibration round count uses the calibrated tolerance', () => {
    assert.deepEqual(toleranceFor(calibrated, 6, 6), {
      tolerance: 1.12,
      floorMs: 0.4,
      calibrated: true,
    })
  })

  test('a run with a different round count falls back to the default', () => {
    const t = toleranceFor(calibrated, 6, 1)
    assert.equal(t.calibrated, false)
    assert.equal(t.tolerance, DEFAULT_TOLERANCE)
  })
})
