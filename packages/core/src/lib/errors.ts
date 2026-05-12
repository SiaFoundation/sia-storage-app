/**
 * Engine-neutral AbortError. React Native's Hermes doesn't expose
 * `DOMException` as a global, so constructing one throws ReferenceError;
 * an Error subclass carrying `name='AbortError'` matches the web abort
 * shape without relying on a browser ambient.
 */
export class AbortError extends Error {
  constructor(message = 'The operation was aborted.') {
    super(message)
    this.name = 'AbortError'
  }
}

/**
 * True if the error originates from an AbortController / AbortSignal.
 * Accepts both DOMException (on engines that provide it) and plain Error
 * with name='AbortError' (our AbortError, polyfills, node's AbortSignal).
 */
export function isAbortError(e: unknown): boolean {
  if (typeof DOMException !== 'undefined' && e instanceof DOMException) {
    return e.name === 'AbortError'
  }
  if (e instanceof Error) return e.name === 'AbortError'
  return false
}

/** Thrown by the mobile DB adapter when the suspension gate is closed. */
export class DatabaseSuspendedError extends Error {
  constructor() {
    super('Database is suspended for background transition')
    this.name = 'DatabaseSuspendedError'
  }
}

/**
 * True for DatabaseSuspendedError. Name-matched (not instanceof) so it
 * survives reconstruction across the AppService IPC boundary.
 */
export function isSuspendedDbError(e: unknown): boolean {
  return e instanceof Error && e.name === 'DatabaseSuspendedError'
}

/**
 * Best-effort human-readable message extraction from an unknown thrown value.
 * Returns Error.message for Error instances, string values as-is, and the
 * string form of primitives (numbers, booleans). For everything else —
 * objects, null, undefined — returns the fallback rather than leaking
 * "[object Object]" or "null" to callers. Default fallback is a generic
 * English message; pass a contextual fallback (e.g. 'Failed to rename')
 * for user-facing surfaces.
 */
export function getErrorMessage(e: unknown, fallback = 'An unknown error occurred'): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  if (typeof e === 'number' || typeof e === 'boolean') return String(e)
  return fallback
}
