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
    (channel, args, timeoutMs) => sia.rpc(channel, args, timeoutMs),
    (handler) => sia.onCache(handler),
    {
      // Both outlive the transport's default: approval waits on a person in a
      // browser tab, and register round-trips the indexer with the new key.
      timeouts: {
        'ds:auth:builder:waitForApproval': 5 * 60 * 1000,
        'ds:auth:builder:register': 60 * 1000,
      },
    },
  )
}
