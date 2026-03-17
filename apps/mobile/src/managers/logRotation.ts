import { createServiceInterval } from '@siastorage/core/lib/serviceInterval'
import {
  LOG_ROTATION_INTERVAL,
  runLogRotation,
} from '@siastorage/core/services'
import { app } from '../stores/appService'

export async function initLogRotation(): Promise<void> {
  await runLogRotation(app())
  initLogRotationInterval()
}

const { init: initLogRotationInterval } = createServiceInterval({
  name: 'logRotation',
  worker: async () => {
    await runLogRotation(app())
  },
  getState: async () => true,
  interval: LOG_ROTATION_INTERVAL,
})
