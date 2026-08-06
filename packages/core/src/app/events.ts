/*
 * One signal that says "something changed".
 *
 * In-process consumers read the SWR caches and re-render from them. A separate
 * process cannot: it has no access to the caches, and polling the database
 * would either lag or burn CPU. This signal is what it waits on.
 *
 * The emitter is synchronous and knows nothing about its listeners, so a cache
 * bust can subscribe to it, and a wire subscribes through `coalesceChanges`,
 * which is where the pacing lives: coalescing is a property of a transport,
 * not of the fact.
 */
import { logger } from '@siastorage/logger'
import { type Coalescer, createCoalescer } from '../lib/coalescer'
import type { ChangeScope } from '../types/changes'

export type ChangeListener = (scope: ChangeScope) => void

/** The subscribing half, which is all most consumers need. */
export type ChangeSource = {
  /** Registers a listener; call the returned function to stop delivery. */
  on(listener: ChangeListener): () => void
}

export type AppEvents = ChangeSource & {
  /** Delivers `scope` to every listener, synchronously. */
  emit(scope: ChangeScope): void
  /** Drops every listener. */
  dispose(): void
}

export function createAppEvents(): AppEvents {
  const listeners = new Set<ChangeListener>()
  return {
    emit(scope) {
      // One listener that throws must not silence the others: a shell
      // connection dropping mid-delivery would otherwise stop the tray from
      // ever updating.
      for (const listener of listeners) {
        try {
          listener(scope)
        } catch (error) {
          logger.warn('appEvents', 'listener_threw', { changeScope: scope, error: error as Error })
        }
      }
    },
    on(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose() {
      listeners.clear()
    },
  }
}

/**
 * A paced view of a source, for a wire.
 *
 * Each scope keeps its own coalescer, so a long run of library writes cannot
 * hold back a connection change. Both edges cross the socket: a lone change
 * lands at once, and a sync writing for minutes still nudges the wire once
 * per window instead of going quiet until it finishes.
 */
export function coalesceChanges(
  source: ChangeSource,
  windowMs = 200,
): ChangeSource & { dispose(): void } {
  const out = createAppEvents()
  const coalescers = new Map<ChangeScope, Coalescer>()

  const stop = source.on((scope) => {
    let coalescer = coalescers.get(scope)
    if (!coalescer) {
      coalescer = createCoalescer(() => out.emit(scope), windowMs)
      coalescers.set(scope, coalescer)
    }
    coalescer.trigger()
  })

  return {
    on: out.on,
    dispose() {
      stop()
      for (const coalescer of coalescers.values()) coalescer.cancel()
      coalescers.clear()
      out.dispose()
    },
  }
}
