/*
 * The library, as this window sees it.
 *
 * A proxy: every call is forwarded to the daemon, and the caches it holds are
 * this window's own. The daemon names each cache change as it happens, and those
 * messages are replayed here, so a hook reading through `app.caches` sees the
 * same change the daemon just made, a key dropped or a value handed over. The
 * hooks in
 * `@siastorage/core/stores` therefore work unchanged, as they do on mobile.
 */

import { createRemoteAppService } from '@siastorage/core/app'
import type { AppService } from '@siastorage/core/app'
import { sia } from './api'

export function createWindowService(): AppService {
  return createRemoteAppService(
    (channel: string, ...args: unknown[]) => sia.rpc(channel, args),
    (handler) => sia.onCache(handler as (message: unknown) => void),
  )
}
