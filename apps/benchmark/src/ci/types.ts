import type { DatasetInfo } from '../types'
import type { CalibratedSpec, Comparison, Tolerance } from './stats'
import type { StructureChange } from './structure'

export type RunnerInfo = {
  os: string
  /** GitHub's runner image, from the ImageOS variable, or null off GitHub. */
  image: string | null
  cpu: string
  cores: number
  memoryGb: number
  node: string
}

export type SpecReport = {
  name: string
  category: string
  iterations: number
  /** Median of each round's samples, one entry per round. */
  headRounds: number[]
  baseRounds: number[] | null
  baseError?: string
  headError?: string
  comparison: Comparison | null
  tolerance: Tolerance
}

export type SuiteReport = {
  name: string
  dataset: DatasetInfo
  baseError?: string
  specs: SpecReport[]
}

export type RunReport = {
  version: 1
  /** `self` times this checkout against a second copy of itself. */
  mode: 'compare' | 'self'
  /** True when both sides ran the same core and adapters, so every difference
   * is noise and the run can feed calibration. */
  sameCode: boolean
  startedAt: string
  durationMs: number
  runner: RunnerInfo
  rounds: number
  head: { commit: string | null }
  base: { commit: string | null } | null
  /** Whether this runner's CPU is one the timing baseline was calibrated on. */
  calibratedRunner: boolean
  suites: SuiteReport[]
  structureChanges: StructureChange[]
  failed: boolean
  failures: string[]
}

export type TimingBaseline = {
  rounds: number
  runners: Omit<RunnerInfo, 'node'>[]
  specs: Record<string, CalibratedSpec>
}
