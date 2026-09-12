/*
 * How much of the library the system has written out to its own copy.
 *
 * Nothing reports it. The system asks for a folder's contents once, as it
 * writes that folder, so a listing arriving is the only evidence of a write and
 * listings going quiet the only evidence the pass is over. The handshake resets
 * it: a fresh extension means an empty copy and a full rewrite.
 */

import { parseDirectoryProviderId } from '@siastorage/core/types'

/** Quiet for this long means the system has stopped, rather than paused. */
const IDLE_MS = 8_000

export type MaterializingState = {
  /** True while folders are still being written out. */
  active: boolean
  /** Folders written out since the extension last connected. */
  done: number
}

export type Materializing = {
  /** Every request the provider socket serves, to keep the count current. */
  observe(method: string, args: readonly unknown[]): void
  state(): MaterializingState
}

export function createMaterializing(now: () => number = Date.now): Materializing {
  let folders = new Set<string>()
  let lastAt = 0

  return {
    observe(method, args) {
      if (method === 'hello') {
        folders = new Set()
        lastAt = 0
        return
      }
      if (method !== 'ds:provider:list') return
      const [container] = args
      // Only folders count: the root, working set and trash are read for their
      // own reasons and would put the total above the library's folder count.
      if (typeof container !== 'string' || parseDirectoryProviderId(container) === null) return
      folders.add(container)
      lastAt = now()
    },

    state() {
      return { active: lastAt > 0 && now() - lastAt < IDLE_MS, done: folders.size }
    },
  }
}
