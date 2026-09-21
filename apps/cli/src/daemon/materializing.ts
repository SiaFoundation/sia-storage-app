/*
 * How much of the library the system has written out to its own copy.
 *
 * The extension states the boundaries, because it is the only process that
 * knows when its own pass began and when the system stopped writing. The
 * daemon cannot see the writes: it serves a folder's contents, and the system
 * puts them on disk afterwards on its own schedule.
 *
 * Progress still comes from the listings, which do measure how far the system
 * has got through the pass.
 */

import { parseDirectoryProviderId } from '@siastorage/core/types'

export type MaterializingState = {
  /** True while folders are still being written out. */
  active: boolean
  /** Folders the system has read since the pass started. */
  done: number
}

export type Materializing = {
  /** Every request the provider socket serves, to keep the count current. */
  observe(method: string, args: readonly unknown[]): void
  /** The extension's pass boundaries. */
  report(phase: 'start' | 'settled'): void
  /** The provider socket dropped: a pass the extension can no longer finish. */
  disconnected(): void
  state(): MaterializingState
}

export function createMaterializing(): Materializing {
  let folders = new Set<string>()
  let active = false

  return {
    observe(method, args) {
      if (!active || method !== 'ds:provider:list') return
      const [container] = args
      // Only folders count: the root, working set and trash are read for their
      // own reasons and would put the total above the library's folder count.
      if (typeof container !== 'string' || parseDirectoryProviderId(container) === null) return
      folders.add(container)
    },

    report(phase) {
      if (phase === 'start') {
        folders = new Set()
        active = true
        return
      }
      active = false
    },

    disconnected() {
      active = false
    },

    state() {
      return { active, done: folders.size }
    },
  }
}
