/**
 * One Metro server per checkout, shared by every phone in every session on
 * both platforms. The app reads which network it joins from `sim.json`,
 * written per device, not from the bundle, so one bundle serves them all, and
 * a second Metro would only repeat the same cold build.
 */
import { join } from 'node:path'
import { BackgroundServer, httpProbe } from './background'
import { defaultSessionName, type PhoneKind, REPO_ROOT, SIM_HOME } from './session'

const metro = new BackgroundServer({
  dir: join(SIM_HOME, `metro-${defaultSessionName()}`),
  name: 'metro',
  command: (port) => ['bunx', 'expo', 'start', '--dev-client', '--port', String(port)],
  cwd: join(REPO_ROOT, 'apps/mobile'),
  // Metro in CI mode does not watch files, so after a source change every
  // phone would keep getting the bundle Metro built first. CI runners set it.
  env: { CI: undefined },
  probe: httpProbe('/status', (body) => body === 'packager-status:running'),
  startTimeoutMs: 120_000,
})

/** Each platform's bundle build, by the Metro process it was asked of. */
const bundles = new Map<string, Promise<void>>()

/**
 * Returns the running Metro's URL, starting one if needed, with the
 * platform's bundle built. The first build takes longer than the dev launcher
 * waits, and a launcher that gives up shows its server list instead of the
 * app, so the bundle is built before any app asks for it. Once built, Metro
 * serves it from its cache, so each platform is asked for once per Metro
 * process, and phones starting together wait on the same request.
 */
export async function ensureMetro(platform: PhoneKind): Promise<string> {
  const { port, pid } = await metro.start()
  const key = `${pid}:${port}:${platform}`
  let built = bundles.get(key)
  if (!built) {
    built = buildBundle(port, platform)
    bundles.set(key, built)
    // A failed build is asked for again by the next phone to start.
    built.catch(() => bundles.delete(key))
  }
  await built
  return `http://127.0.0.1:${port}`
}

/**
 * Requests the bundle the dev client will. The client asks Metro for its
 * manifest with these two headers and loads the manifest's launch asset. The
 * asset's URL varies only in its host, 10.0.2.2 on an emulator, and Metro's
 * cache is keyed on the bundle's path and query, not the host.
 */
async function buildBundle(port: number, platform: PhoneKind): Promise<void> {
  const started = Date.now()
  const answer = await fetch(`http://127.0.0.1:${port}`, {
    headers: { 'expo-platform': platform, accept: 'application/expo+json,application/json' },
    signal: AbortSignal.timeout(60_000),
  })
  if (!answer.ok) {
    throw new Error(`Metro could not serve the ${platform} manifest: HTTP ${answer.status}`)
  }
  const manifest = (await answer.json()) as { launchAsset: { url: string } }
  // Long enough for a cold bundle build, and finite, since a Metro wedged
  // mid-build never answers.
  const res = await fetch(manifest.launchAsset.url, { signal: AbortSignal.timeout(10 * 60_000) })
  if (!res.ok) throw new Error(`Metro could not build the ${platform} bundle: HTTP ${res.status}`)
  await res.arrayBuffer()
  console.error(
    `Metro had the ${platform} bundle ready in ${((Date.now() - started) / 1000).toFixed(1)}s`,
  )
}

export function stopMetro(inUse?: () => boolean): Promise<void> {
  return metro.stop(inUse)
}
