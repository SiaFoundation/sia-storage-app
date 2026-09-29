/**
 * Simulation test mode. When a `sim` harness has written `sim.json` into the
 * app's documents folder, the app signs in without a browser, talks to the
 * mock network it names in place of the Sia SDK, and opens a control socket
 * the harness drives it through. Without the file, `simNetwork` is null and the
 * app is unchanged.
 *
 * A file rather than launch arguments because Android has no launch arguments
 * JavaScript can read, and the choice has to be made synchronously, before the
 * app's services are built at import time. The harness rewrites it on every
 * start of the device.
 *
 * Only a development bundle looks for the file. The modules that act on it,
 * sdkAuth.ts and remoteControl.ts with the mock network client they import,
 * are loaded by a `require` inside an `if (__DEV__)` branch, which Metro
 * removes from a release bundle along with everything it requires.
 */
// oxlint-disable-next-line no-restricted-imports -- one small synchronous read at startup, debug builds only
import { File, Paths } from 'expo-file-system'

export type SimNetwork = { url: string; device: string }

type SimConfig = SimNetwork & { fastTimers?: boolean }

function readSimNetwork(): SimNetwork | null {
  if (!__DEV__) return null
  const file = new File(Paths.document, 'sim.json')
  if (!file.exists) return null
  const config = JSON.parse(file.textSync()) as Partial<SimConfig>
  if (!config.url || !config.device) throw new Error('sim.json needs url and device')
  // The core reads its timers from the environment once, when its config
  // module loads, so this only works because the app's entry imports this
  // module before anything that imports the core.
  if (config.fastTimers) process.env.EXPO_PUBLIC_SIM_FAST_TIMERS = '1'
  return { url: config.url, device: config.device }
}

export const simNetwork = readSimNetwork()
