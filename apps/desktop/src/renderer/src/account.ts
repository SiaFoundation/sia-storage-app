/*
 * Whether this Mac has an account, as the window knows it.
 *
 * The daemon answers yes or no, or cannot be asked because it is starting,
 * too busy to answer in time, or down. Only its no is a reason to show
 * sign-in: a daemon migrating its database after an update still holds its
 * account, and sign-in shown over it invites pairing the Mac a second time.
 * An earlier answer stands through a read that fails, so a daemon that stops
 * answering for a moment does not move the window. With no answer yet the
 * window shows the status view, which names a daemon that is not running.
 */

/**
 * `asking` until the first read returns, and `unreachable` when it failed
 * with nothing known before it.
 */
export type Account = 'asking' | 'unreachable' | 'signed-in' | 'signed-out'

/** `answer` is the daemon's, or null when it could not be asked. */
export function nextAccount(prev: Account, answer: boolean | null): Account {
  if (answer !== null) return answer ? 'signed-in' : 'signed-out'
  return prev === 'asking' ? 'unreachable' : prev
}
