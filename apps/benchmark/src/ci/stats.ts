/*
 * Turns paired timing rounds into a verdict per spec, and A/A runs into the
 * tolerances that verdict uses.
 *
 * Each round times a spec on the base side and the PR side back to back, so
 * the ratio within one round cancels most of whatever the runner was doing at
 * that moment. The verdict uses the median of those per-round ratios, and
 * calls a spec slower only when it is past its tolerance, past an absolute
 * floor, and slower in most rounds. One bad round cannot fail a PR, and a
 * sub-millisecond read cannot fail one on a 20% swing of 0.05ms.
 */

export const DEFAULT_TOLERANCE = 1.5
export const DEFAULT_FLOOR_MS = 1
/** Share of rounds that must agree on the direction before a verdict counts. */
const AGREEMENT = 0.8
const MIN_TOLERANCE = 1.1
const MAX_TOLERANCE = 3
const MIN_FLOOR_MS = 0.25

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export type Verdict = 'slower' | 'faster' | 'same' | 'unsteady' | 'no-base'

/** A round faster than the timer resolves reads as 0 ms. Both sides are
 * clamped to 1ns so its ratio stays finite and its log stays defined. */
function roundRatios(headRounds: number[], baseRounds: number[]): number[] {
  return headRounds.map((h, i) => Math.max(h, 1e-6) / Math.max(baseRounds[i], 1e-6))
}

export type Comparison = {
  baseMs: number | null
  headMs: number
  /** Median of per-round head/base ratios. */
  ratio: number | null
  slowerRounds: number
  rounds: number
  verdict: Verdict
}

export type Tolerance = { tolerance: number; floorMs: number; calibrated: boolean }

export function compareRounds(
  headRounds: number[],
  baseRounds: number[] | null,
  tol: Tolerance,
): Comparison {
  const headMs = median(headRounds)
  if (!baseRounds || baseRounds.length !== headRounds.length) {
    return {
      baseMs: null,
      headMs,
      ratio: null,
      slowerRounds: 0,
      rounds: headRounds.length,
      verdict: 'no-base',
    }
  }
  const baseMs = median(baseRounds)
  const ratios = roundRatios(headRounds, baseRounds)
  const ratio = median(ratios)
  const slowerRounds = ratios.filter((r) => r > 1).length
  const fasterRounds = ratios.filter((r) => r < 1).length
  const needed = Math.ceil(ratios.length * AGREEMENT)

  let verdict: Verdict = 'same'
  if (ratio > tol.tolerance && headMs - baseMs > tol.floorMs) {
    verdict = slowerRounds >= needed ? 'slower' : 'unsteady'
  } else if (ratio < 1 / tol.tolerance && baseMs - headMs > tol.floorMs) {
    verdict = fasterRounds >= needed ? 'faster' : 'unsteady'
  }
  return { baseMs, headMs, ratio, slowerRounds, rounds: ratios.length, verdict }
}

export type CalibrationSample = {
  headRounds: number[]
  baseRounds: number[]
}

export type CalibratedSpec = {
  medianMs: number
  tolerance: number
  floorMs: number
  /** A/A runs the tolerance was computed from. */
  runs: number
}

/**
 * Tolerance from A/A runs, where both sides ran identical code so every
 * difference is noise.
 *
 * The spread of single-round log ratios is pooled across runs and scaled down
 * to the spread of a median of `rounds` of them, which is what the verdict
 * compares. Four of those spreads would fail an unchanged spec about once in
 * 30,000 runs if the noise were normal. Runner noise has heavier tails than
 * that, so the largest ratio any A/A run actually produced, plus a quarter, is
 * a second lower bound.
 */
export function calibrate(samples: CalibrationSample[], rounds: number): CalibratedSpec {
  if (samples.length === 0) throw new Error('calibrate needs at least one sample')
  for (const { headRounds, baseRounds } of samples) {
    if (headRounds.length < rounds || baseRounds.length < rounds) {
      throw new Error(`a calibration sample has fewer than ${rounds} rounds on one side`)
    }
  }
  const logRatios: number[] = []
  const runRatios: number[] = []
  const absDiffs: number[] = []
  const medians: number[] = []
  for (const { headRounds, baseRounds } of samples) {
    const ratios = roundRatios(headRounds, baseRounds)
    for (const r of ratios) logRatios.push(Math.log(r))
    runRatios.push(Math.abs(Math.log(median(ratios))))
    absDiffs.push(Math.abs(median(headRounds) - median(baseRounds)))
    medians.push(median(headRounds), median(baseRounds))
  }

  const center = median(logRatios)
  const sigma = 1.4826 * median(logRatios.map((v) => Math.abs(v - center)))
  const medianSigma = (1.2533 * sigma) / Math.sqrt(rounds)
  const logTolerance = Math.max(
    4 * medianSigma,
    1.25 * Math.max(...runRatios),
    Math.log(MIN_TOLERANCE),
  )

  return {
    medianMs: round(median(medians)),
    tolerance: round(Math.min(Math.exp(logTolerance), MAX_TOLERANCE), 100),
    floorMs: round(Math.max(MIN_FLOOR_MS, 1.5 * Math.max(...absDiffs))),
    runs: samples.length,
  }
}

/**
 * The tolerance a spec is judged by. A calibrated tolerance is sized for a
 * median over the calibration's round count, so a run with a different count,
 * whose median is noisier or steadier than that, falls back to the default.
 */
export function toleranceFor(
  calibrated: CalibratedSpec | undefined,
  calibratedRounds: number | undefined,
  rounds: number,
): Tolerance {
  if (calibrated && calibratedRounds === rounds) {
    return { tolerance: calibrated.tolerance, floorMs: calibrated.floorMs, calibrated: true }
  }
  return { tolerance: DEFAULT_TOLERANCE, floorMs: DEFAULT_FLOOR_MS, calibrated: false }
}

export function round(n: number, factor = 1000): number {
  return Math.round(n * factor) / factor
}
