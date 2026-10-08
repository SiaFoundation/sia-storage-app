// Moves the account's share links to their files' current versions and picks
// up links made, changed or revoked on other devices.
//
// A suspension pauses the scheduler, so no pass starts during one. A pass
// already running is not cancelled: a write it makes while the database is
// suspending throws DatabaseSuspendedError, runShareLinkSync logs the pass as
// failed, and the tick after resume starts over.

import { SHARE_LINKS_INTERVAL } from '@siastorage/core/config'
import { createServiceInterval } from '@siastorage/core/lib/serviceInterval'
import { runShareLinkSync } from '@siastorage/core/services'
import { app } from '../stores/appService'

export const { init: initShareLinks } = createServiceInterval({
  name: 'shareLinks',
  worker: async (signal) => {
    if (signal.aborted) return
    await runShareLinkSync(app())
  },
  interval: SHARE_LINKS_INTERVAL,
})
