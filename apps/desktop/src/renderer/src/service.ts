/*
 * The library, as this window sees it.
 *
 * A proxy: every call is forwarded to the daemon, and the caches are this
 * window's own. The daemon names each cache change and those are replayed here,
 * so a hook reading `app.caches` sees the change the daemon just made and the
 * hooks in `@siastorage/core/stores` work unchanged, as they do on mobile.
 */

import { createRemoteAppService } from '@siastorage/core/app'
import type { AppService } from '@siastorage/core/app'
import { sia } from './api'

export function createWindowService(): AppService {
  return createRemoteAppService(
    (channel: string, ...args: unknown[]) => sia.rpc(channel, args),
    (handler) => sia.onCache(handler),
  )
}
