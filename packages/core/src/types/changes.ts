/*
 * The change signal: a scope and nothing else. A listener re-reads whatever it
 * wants, so a dropped or doubled signal costs freshness, never correctness.
 * The scopes are separate domains, not a hierarchy: `library` is no superset
 * of `connection`, so one can never stand in for another.
 */

/** The part of the app a change refers to. */
export type ChangeScope = 'library' | 'connection' | 'sync'

/** A change on a wire, for a listener in another process. */
export type ChangeEvent = {
  event: 'change'
  scope: ChangeScope
}
