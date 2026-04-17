// Periodically rotates old log records out of the DB to bound storage.
//
// Suspension signal policy: accepts AbortSignal. Touches the DB
// (deletes old log records) but the work is fast and idempotent. The
// signal check is cheap insurance and pattern consistency.

import { createServiceInterval } from '@siastorage/core/lib/serviceInterval'
import { LOG_ROTATION_INTERVAL, runLogRotation } from '@siastorage/core/services'
import { app } from '../stores/appService'

export async function initLogRotation(): Promise<void> {
  await runLogRotation(app())
  initLogRotationInterval()
}

async function run(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return
  await runLogRotation(app())
}

const { init: initLogRotationInterval } = createServiceInterval({
  name: 'logRotation',
  worker: run,
  interval: LOG_ROTATION_INTERVAL,
})
