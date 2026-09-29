/**
 * One Appium server per checkout, which every phone's UI session goes through.
 * Appium reads each platform's accessibility tree without the app changing:
 * WebDriverAgent on iOS, UiAutomator2 on Android. The drivers install on first
 * use into an Appium home under SIM_HOME, at the versions pinned here, so a
 * fresh machine or CI job needs nothing set up by hand.
 */
import { $ } from 'bun'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { BackgroundServer, httpProbe } from '../background'
import { withFileLock } from '../lock'
import { defaultSessionName, REPO_ROOT, SIM_HOME } from '../session'

const APPIUM = join(REPO_ROOT, 'node_modules/.bin/appium')
const DRIVERS = {
  xcuitest: 'appium-xcuitest-driver@11.17.7',
  uiautomator2: 'appium-uiautomator2-driver@8.1.0',
}
/**
 * One Appium home per set of pinned driver versions, shared by every checkout
 * that pins the same ones. A checkout pinning others gets its own home rather
 * than reinstalling drivers under a server another checkout is running.
 */
const APPIUM_HOME = join(
  SIM_HOME,
  `appium-home-${new Bun.CryptoHasher('sha256').update(JSON.stringify(DRIVERS)).digest('hex').slice(0, 12)}`,
)

/**
 * Installs each pinned driver the Appium home lacks. Checkouts pinning the
 * same versions share the home, so this runs under a lock on it, not only
 * under the checkout's own Appium start lock.
 */
function installDrivers(): Promise<void> {
  mkdirSync(APPIUM_HOME, { recursive: true })
  return withFileLock(join(APPIUM_HOME, 'install.lock'), installPinnedDrivers)
}

async function installPinnedDrivers(): Promise<void> {
  const env = { ...process.env, APPIUM_HOME }
  const listed = await $`${APPIUM} driver list --installed --json`.env(env).quiet().nothrow().text()
  const installed = (listed.trim() ? JSON.parse(listed) : {}) as Record<
    string,
    { installSpec?: string }
  >
  for (const [name, spec] of Object.entries(DRIVERS)) {
    if (installed[name]?.installSpec === spec) continue
    await $`${APPIUM} driver install --source=npm ${spec}`.env(env).quiet()
  }
}

const appium = new BackgroundServer({
  dir: join(SIM_HOME, `appium-${defaultSessionName()}`),
  name: 'appium',
  command: (port) => [APPIUM, '--address', '127.0.0.1', '--port', String(port)],
  env: { APPIUM_HOME },
  probe: httpProbe('/status'),
  beforeStart: installDrivers,
})

let url: Promise<string> | null = null

/** The Appium server's URL, starting it once per process, or again after a failed start. */
export function ensureAppium(): Promise<string> {
  url ??= appium
    .start()
    .then(({ port }) => `http://127.0.0.1:${port}`)
    .catch((e: unknown) => {
      url = null
      throw e
    })
  return url
}

export function stopAppium(inUse?: () => boolean): Promise<void> {
  return appium.stop(inUse)
}
