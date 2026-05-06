import { mutate } from 'swr'
import { addForegroundFocusListener } from '../managers/lifecycle'

/**
 * Revalidate every mounted SWR hook on app foreground via
 * `mutate(() => true)`. SWR's `initFocus` override is inert without a
 * custom cache `provider` (which would fork the cache from the global
 * `mutate` used by `swrCache` helpers), so we drive the broadcast
 * ourselves. The lifecycle module queues this callback on a microtask
 * after the suspension manager has un-gated the DB.
 */
export function initForegroundRefresh(): () => void {
  return addForegroundFocusListener(() => {
    void mutate(() => true)
  })
}
