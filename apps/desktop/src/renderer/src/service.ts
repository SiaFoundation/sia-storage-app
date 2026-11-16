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
import { paceLibraryClears } from './cacheMessages'

export function createWindowService(): AppService {
  return createRemoteAppService(
    (channel, args, timeoutMs) => sia.rpc(channel, args, timeoutMs),
    (handler) => sia.onCache(paceLibraryClears(handler, 1_000)),
    {
      // Both outlive the transport's default: approval waits on a person in a
      // browser tab, and register round-trips the indexer with the new key.
      timeouts: {
        'ds:auth:builder:waitForApproval': 5 * 60 * 1000,
        'ds:auth:builder:register': 60 * 1000,
        // Each makes a round trip to the indexer per file or per link, and
        // runs after any link change already under way.
        'ds:shares:createLink': 2 * 60 * 1000,
        'ds:shares:addLinkFiles': 2 * 60 * 1000,
        'ds:shares:removeLinkFiles': 2 * 60 * 1000,
        'ds:shares:revokeLink': 2 * 60 * 1000,
        'ds:shares:syncLinks': 2 * 60 * 1000,
      },
    },
  )
}
