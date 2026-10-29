import type { DatasetInfo } from '../types'
import type { SpecStructure } from './structure'

export type WorkerRequest =
  | { type: 'time'; spec: string; iterations: number }
  | { type: 'profile' }
  | { type: 'exit' }

export type WorkerReply =
  | { type: 'ready'; dataset: DatasetInfo; specs: { name: string; category: string }[] }
  | { type: 'timed'; samples: number[] }
  /** `errors` holds the specs that threw, which are absent from `specs`. */
  | { type: 'profiled'; specs: Record<string, SpecStructure>; errors: Record<string, string> }
  | { type: 'error'; message: string }
