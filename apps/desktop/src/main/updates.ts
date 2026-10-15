/*
 * Keeps a distributed build up to date.
 *
 * A minute after launch and every four hours after, this reads the
 * repository's releases, picks the newest one this build's channel takes
 * (`updateFeed.ts`), and hands its zip to Electron's autoUpdater. On macOS
 * that is Squirrel, which downloads the zip, rejects a bundle not signed to
 * this one's designated requirement, and stages it. Once it is staged the
 * tray and overflow menus, a card in the popover and the window, and a
 * notification say so, and Restart to Update quits, lets Squirrel swap the
 * bundle, and relaunches. A staged update the user never restarts for is
 * applied the next time the app starts.
 *
 * Squirrel makes no version decision of its own. Its feed is a URL answering
 * 204 for no update or JSON naming a zip, and GitHub serves nothing of that
 * shape, so the choice is made here and its answer served to Squirrel from
 * 127.0.0.1 for the length of one download.
 *
 * After the relaunch the previous build's daemon may still be running, and
 * startup replaces it (`Daemon.reconcile`).
 */

import {
  app,
  autoUpdater,
  dialog,
  type MenuItemConstructorOptions,
  net,
  Notification,
} from 'electron'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { DesktopConfig } from './config'
import { log } from './log'
import { buildVariant } from './paths'
import { type AvailableUpdate, type FeedRelease, pickUpdate } from './updateFeed'
import { parseVersion } from './versions'
import { beginQuit, cancelQuit } from './windows'

const FEED = 'https://api.github.com/repos/SiaFoundation/sia-storage-app/releases'
/** Clear of startup, which spends its first seconds attaching the daemon and the mount. */
const FIRST_CHECK_MS = 60_000
const CHECK_EVERY_MS = 4 * 60 * 60_000
/** The API's largest page. */
const PAGE_SIZE = 100
/**
 * Unauthenticated, the API allows each address 60 requests an hour, and the
 * releases of every package in the repository share these pages. Three reach
 * back 300 releases for at most three requests a check.
 */
const MAX_PAGES = 3
/**
 * One check, response bodies included. While a check is pending every later
 * one returns early, so a response that stalled forever would end checking
 * until the app restarted.
 */
const CHECK_TIMEOUT_MS = 60_000

export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'downloading'; version: string }
  /** Staged by Squirrel, installed by a restart. */
  | { status: 'ready'; version: string }

let settings: NonNullable<DesktopConfig['updates']> | null = null
let appName = 'Sia Storage'
let state: UpdateState = { status: 'idle' }
/** What a failed check or download goes back to, so a staged update is not forgotten. */
let settled: UpdateState = { status: 'idle' }
let feedServer: Server | null = null
let installing = false
/** Set while a check the user asked for downloads, so a failure is reported. */
let reportDownloadFailure = false
let announced: string | null = null
let changed: (state: UpdateState) => void = () => {}

/**
 * Starts checking, for a build packaged with a channel, which dev and test
 * builds are not by default. A source run has no bundle for Squirrel to
 * replace, so it never checks.
 */
export function startUpdates(config: DesktopConfig, onChange: (state: UpdateState) => void): void {
  if (!config.updates || !app.isPackaged) return
  // Squirrel compares nothing, so a version this cannot order would be
  // offered every release, including the one it is already running.
  if (!parseVersion(app.getVersion())) {
    log.error('updates', 'unordered_version', { version: app.getVersion() })
    return
  }
  settings = config.updates
  appName = config.displayName
  changed = onChange

  autoUpdater.on('update-downloaded', () => {
    closeFeed()
    reportDownloadFailure = false
    if (state.status !== 'downloading') return
    const { version } = state
    log.info('updates', 'ready', { version })
    settle({ status: 'ready', version })
    announce(version)
  })
  autoUpdater.on('update-not-available', () => {
    closeFeed()
    set(settled)
  })
  autoUpdater.on('error', (error) => {
    closeFeed()
    log.error('updates', installing ? 'install_failed' : 'download_failed', { error })
    if (reportDownloadFailure && !installing) {
      void report('Could not download the update', 'Check the connection and try again.')
    }
    reportDownloadFailure = false
    if (installing) {
      // The quit Squirrel was to finish never came, and the windows it closed
      // are rebuilt on the next click, so the app goes on as it was.
      installing = false
      cancelQuit()
      void report(
        `${appName} could not install the update`,
        'Try again later. If the app is not in the Applications folder, move it there first.',
      )
    }
    set(settled)
  })

  setTimeout(() => void checkForUpdates(false), FIRST_CHECK_MS)
  setInterval(() => void checkForUpdates(false), CHECK_EVERY_MS)
}

export function updateState(): UpdateState {
  return state
}

/**
 * Looks for a newer release and starts its download. `manual` is a check the
 * user asked for, which reports its outcome when there is nothing to download.
 */
export async function checkForUpdates(manual: boolean): Promise<void> {
  if (!settings || installing || state.status === 'checking' || state.status === 'downloading') {
    return
  }
  // A download hides the staged update's Restart until it ends, so only a
  // check the user asked for replaces a staged update with a newer one.
  if (state.status === 'ready' && !manual) return
  const current = state.status === 'ready' ? state.version : app.getVersion()
  set({ status: 'checking' })
  let update: AvailableUpdate | null
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    update = await Promise.race([
      findUpdate(settings, current),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('The release check timed out')), CHECK_TIMEOUT_MS)
      }),
    ])
  } catch (e) {
    log.error('updates', 'check_failed', { error: e as Error })
    set(settled)
    if (manual) await report('Could not check for updates', 'Check the connection and try again.')
    return
  } finally {
    clearTimeout(timer)
  }
  if (!update) {
    set(settled)
    if (manual) {
      await report(
        settled.status === 'ready' ? 'An update is ready' : `${appName} is up to date`,
        settled.status === 'ready'
          ? `Restart ${appName} to install version ${settled.version}.`
          : `Version ${app.getVersion()} is the newest.`,
      )
    }
    return
  }
  log.info('updates', 'downloading', { version: update.version })
  set({ status: 'downloading', version: update.version })
  reportDownloadFailure = manual
  try {
    autoUpdater.setFeedURL({ url: await serveFeed(update) })
    autoUpdater.checkForUpdates()
  } catch (e) {
    closeFeed()
    log.error('updates', 'download_failed', { error: e as Error })
    set(settled)
    if (manual) await report('Could not download the update', 'Check the connection and try again.')
  }
}

/** Quits and lets Squirrel swap the bundle and relaunch. Nothing to do until one is staged. */
export function installUpdate(): void {
  if (state.status !== 'ready' || installing) return
  log.info('updates', 'installing', { version: state.version })
  installing = true
  // quitAndInstall closes every window before it quits, and until a quit has
  // begun the main window's close handler hides it instead, which would hold
  // the install forever. The app's quit handler then hides the Finder folder
  // and stops a daemon this app owns before the process exits.
  beginQuit()
  autoUpdater.quitAndInstall()
}

/** The tray and overflow menus' update item, or nothing for a build that never updates. */
export function updateMenuItems(): MenuItemConstructorOptions[] {
  if (!settings) return []
  switch (state.status) {
    case 'ready':
      return [{ label: `Restart to Update to ${state.version}`, click: installUpdate }]
    case 'downloading':
      return [{ label: `Downloading ${state.version}…`, enabled: false }]
    case 'checking':
      return [{ label: 'Checking for Updates…', enabled: false }]
    case 'idle':
      return [{ label: 'Check for Updates…', click: () => void checkForUpdates(true) }]
  }
}

/**
 * Reads every page up to the cap before choosing. The API lists releases by
 * when they were created, not by version, so a backport published after a
 * higher release sits above it, and stopping at the first page with an answer
 * would miss the higher one.
 */
async function findUpdate(
  options: NonNullable<DesktopConfig['updates']>,
  current: string,
): Promise<AvailableUpdate | null> {
  const feed = feedUrl()
  const releases: FeedRelease[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const response = await net.fetch(`${feed}?per_page=${PAGE_SIZE}&page=${page}`, {
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!response.ok) throw new Error(`${feed} answered ${response.status}`)
    const batch = (await response.json()) as FeedRelease[]
    releases.push(...batch)
    if (batch.length < PAGE_SIZE) break
  }
  return pickUpdate(releases, { ...options, current })
}

/**
 * The releases list, or the one `SIA_UPDATE_FEED` names on a dev or test
 * build, which is how an update is tried against a local server before a
 * release exists. Such a build checks only when packaged with
 * `SIA_UPDATE_CHANNEL` set, and a distributed build ignores the override.
 */
function feedUrl(): string {
  const override = process.env.SIA_UPDATE_FEED
  return override && ['dev', 'test'].includes(buildVariant()) ? override : FEED
}

/** Serves Squirrel the one answer it needs, on a port of the system's choosing. */
function serveFeed(update: AvailableUpdate): Promise<string> {
  closeFeed()
  const body = JSON.stringify({ url: update.url, name: update.version })
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(body)
  })
  feedServer = server
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`)
    })
  })
}

function closeFeed(): void {
  feedServer?.close()
  feedServer = null
}

/** Once per version: a check every four hours would otherwise repeat it. */
function announce(version: string): void {
  if (announced === version || !Notification.isSupported()) return
  announced = version
  const notification = new Notification({
    title: 'Update ready',
    body: `Restart ${appName} to install version ${version}.`,
  })
  // The click restarts, as the text asks. Sending it to the window instead
  // strands someone not yet signed in, whose window shows sign-in and has no
  // Restart card.
  notification.on('click', () => installUpdate())
  notification.show()
}

/**
 * A tray app has no window of its own in front, so the dialog is brought
 * forward with the app or it opens behind whatever the user was in.
 */
async function report(message: string, detail: string): Promise<void> {
  app.focus({ steal: true })
  await dialog.showMessageBox({ message, detail })
}

function settle(next: UpdateState): void {
  settled = next
  set(next)
}

function set(next: UpdateState): void {
  state = next
  changed(state)
}
