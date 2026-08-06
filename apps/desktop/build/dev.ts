/*
 * The development loop, and the only one that produces a working app.
 *
 * A run from source has no Finder folder: registering one needs a signed helper
 * in an app LaunchServices knows about, so this packages, signs and installs
 * every run. The renderer is swappable without re-signing so it comes from a dev
 * server; main, preload and Swift are inside the signed bundle and need a
 * restart.
 */

import { $ } from 'bun'
import { createServer } from 'vite'
import viteConfig from '../electron.vite.config'
import { loadEnv } from './env'
import { packageApp } from './package'

const RENDERER_URL = 'http://localhost:5173'

const env = loadEnv(process.argv[2] ?? process.env.SIA_CONTEXT ?? 'dev')

/*
 * Vite serves the renderer directly, from the same config section the packaged
 * build uses, so the two cannot describe different apps.
 *
 * `electron-vite dev` is not usable here even with `--rendererOnly`: that flag
 * only skips rebuilding the main process, and it starts an Electron app either
 * way. That app runs from the source tree, so it would compete with the signed
 * one for the tray and the daemon socket.
 */
const server = await createServer({ ...viteConfig.renderer, configFile: false })
await server.listen()

const stop = () => {
  // The installed app keeps running otherwise, holding the tray with a dead
  // renderer URL until something quits it.
  void $`osascript -e ${`quit app "${env.appName}"`}`
    .nothrow()
    .then(() => server.close())
    .then(() => process.exit(0))
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)

try {
  // Passed through rather than inherited: `open` gives the app a launch context
  // of its own, and a scratch library set in this shell would otherwise be lost.
  const launchEnv: Record<string, string> = { ELECTRON_RENDERER_URL: RENDERER_URL }
  if (process.env.SIA_DATA_DIR) launchEnv.SIA_DATA_DIR = process.env.SIA_DATA_DIR

  await packageApp(env, launchEnv)

  console.log(`\nRenderer: ${RENDERER_URL}, reloading on save.`)
  console.log('Main process, preload and Swift changes need this restarted.')
  console.log('Ctrl-C to stop.')
} catch (e) {
  await server.close()
  throw e
}

// Nothing else to do: the app runs on its own and this holds the dev server up.
await new Promise(() => {})
