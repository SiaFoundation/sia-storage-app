/*
 * Keeps a distributed build up to date.
 *
 * A minute after launch and every four hours after, this reads the
 * repository's releases, picks the newest one this build's channel takes
 * (`updateFeed.ts`), and hands its zip to Electron's autoUpdater. On macOS
 * that is Squirrel, which downloads the zip, rejects a bundle not signed to
 * this one's designated requirement, and stages it. Once it is staged the
 * tray and overflow menus, a card in the popover and the window, and a
 * notification say so, and Restart to Update closes the windows, quits, lets
 * Squirrel swap the bundle, and relaunches. Quitting any other way installs
 * the staged update too, without the relaunch.
 *
 * Checks go on while an update waits for its restart, so a release published
 * in the meantime replaces it and one restart lands on the newest. Restart
 * keeps offering the staged version until the newer one is staged in its
 * place, and a Restart clicked during that download installs the staged one.
 * Squirrel stages each download in a directory of its own and points its
 * install request (`ShipItState.plist` in its caches directory) at the new
 * bundle only once that bundle has passed its signature check, and ShipIt
 * reads the request after the app exits, so it installs whichever bundle was
 * complete last.
 *
 * Squirrel makes no version decision of its own. Its feed is a URL answering
 * 204 for no update or JSON naming a zip, and GitHub serves nothing of that
 * shape, so the choice is made here and its answer served to Squirrel from
 * 127.0.0.1.
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
import { beginQuit, cancelQuit, destroyAllWindows } from './windows'

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
/**
 * From Restart to the quit Squirrel asks for. Destroying the windows and
 * writing Squirrel's one request file take well under a second, so an install
 * still waiting after this has stalled. Without the bound a stall leaves
 * Restart doing nothing until the app is quit by hand.
 */
const INSTALL_TIMEOUT_MS = 15_000

export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'downloading'; version: string }
  /** Staged by Squirrel, installed by a restart. */
  | { status: 'ready'; version: string }

let settings: NonNullable<DesktopConfig['updates']> | null = null
let appName = 'Sia Storage'
let state: UpdateState = { status: 'idle' }
/** The version Squirrel has staged and will install when the app quits. */
let staged: string | null = null
/** A check or download in flight. While an update is staged it runs out of sight. */
let work: Extract<UpdateState, { status: 'checking' | 'downloading' }> | null = null
/**
 * Every Squirrel check starts by deleting all its update directories unless
 * its updater object holds a staged update, and that object stops holding one
 * when a later download fails. A check after such a failure deletes the staged
 * bundle while the install request still names it, and Restart then fails to
 * install and relaunches the old version. So a failed download of a newer
 * release clears this, and checking stops until a restart installs the staged
 * update.
 */
let stagedSurvivesCheck = true
/** The release the local feed offers Squirrel, until its download is staged. */
let offered: AvailableUpdate | null = null
let feedServer: Server | null = null
let installing = false
let installTimer: ReturnType<typeof setTimeout> | undefined
/** Set once the app has begun to exit, after which an error has nothing left to undo. */
let quitting = false
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
    reportDownloadFailure = false
    // Read from the feed's offer rather than from `work`, which an error
    // during Restart clears even though the download may still finish.
    const version = offered?.version
    if (!version) return
    log.info('updates', 'ready', { version, replaced: staged })
    offered = null
    if (work?.status === 'downloading') work = null
    staged = version
    stagedSurvivesCheck = true
    show()
    // A download that finishes after Restart was clicked is installed by
    // the same quit, so there is nothing to announce.
    if (!installing) announce(version)
  })
  // Squirrel's answer when the zip server says it already has the zip. Only a
  // download that failed is repeated here, and Squirrel forgets the zip's
  // ETag when one fails, so this is not expected.
  autoUpdater.on('update-not-available', () => {
    work = null
    show()
  })
  autoUpdater.on('error', (error) => {
    if (quitting) return
    // A Restart clicked during a download leaves both in flight, and the event
    // does not say which failed. It is put down to the download. An install
    // that failed as well is still caught by its timer, and a download that
    // finishes after all is still staged.
    if (work?.status === 'downloading') {
      log.error('updates', 'download_failed', { version: work.version, error })
      work = null
      if (staged) stagedSurvivesCheck = false
      if (reportDownloadFailure && !installing) {
        void report('Could not download the update', 'Check the connection and try again.')
      }
      reportDownloadFailure = false
    } else if (installing) {
      log.error('updates', 'install_failed', { error })
      abandonInstall()
    } else {
      log.error('updates', 'updater_failed', { error })
    }
    show()
  })
  // Squirrel asks the app to quit only after writing the request to install
  // and relaunch, so from here the quit decides when the process exits.
  app.on('before-quit', () => {
    quitting = true
    clearTimeout(installTimer)
  })

  setTimeout(() => void checkForUpdates(false), FIRST_CHECK_MS)
  setInterval(() => void checkForUpdates(false), CHECK_EVERY_MS)
}

export function updateState(): UpdateState {
  return state
}

/**
 * Looks for a release newer than the running one, or than the staged one if
 * there is one, and starts its download. `manual` is a check the user asked
 * for, which reports its outcome when there is nothing to download.
 */
export async function checkForUpdates(manual: boolean): Promise<void> {
  if (!settings || installing || work) return
  if (staged && !stagedSurvivesCheck) return
  const current = staged ?? app.getVersion()
  work = { status: 'checking' }
  show()
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
    work = null
    show()
    if (manual) await report('Could not check for updates', 'Check the connection and try again.')
    return
  } finally {
    clearTimeout(timer)
  }
  if (!update) {
    work = null
    show()
    if (manual) {
      await report(
        staged ? 'An update is ready' : `${appName} is up to date`,
        staged
          ? `Restart ${appName} to install version ${staged}.`
          : `Version ${app.getVersion()} is the newest.`,
      )
    }
    return
  }
  log.info('updates', 'downloading', { version: update.version, staged })
  work = { status: 'downloading', version: update.version }
  show()
  reportDownloadFailure = manual
  try {
    await offer(update)
    autoUpdater.checkForUpdates()
  } catch (e) {
    log.error('updates', 'download_failed', { version: update.version, error: e as Error })
    work = null
    show()
    if (manual) await report('Could not download the update', 'Check the connection and try again.')
  }
}

/**
 * Quits and lets Squirrel swap the bundle and relaunch. Nothing to do until one
 * is staged. A download still running is left to finish or not: Squirrel
 * installs the bundle its install request names when the app exits, which is
 * the staged one unless the download completes first.
 *
 * quitAndInstall hands the app to Squirrel only once Electron's window list is
 * empty. Given open windows it closes them and waits for the list to empty,
 * and a window opened during that wait keeps it from ever emptying, with no
 * error. Clicking the update notification does exactly that: macOS also
 * activates the app, and activating opens the main window. So the windows are
 * destroyed here first, `beginQuit` stops any from opening, and quitAndInstall
 * is called on an empty list, where it goes straight to Squirrel. `destroy`
 * also skips the main window's close handler, which would hide the window
 * rather than close it.
 *
 * The app's quit handler then hides the Finder folder and stops a daemon this
 * app owns before the process exits.
 */
export function installUpdate(): void {
  if (!staged || installing) return
  log.info('updates', 'installing', {
    version: staged,
    downloading: work?.status === 'downloading' ? work.version : null,
  })
  installing = true
  beginQuit()
  installTimer = setTimeout(() => {
    log.error('updates', 'install_stalled', { version: staged })
    abandonInstall()
  }, INSTALL_TIMEOUT_MS)
  void destroyAllWindows().then(() => {
    if (installing) autoUpdater.quitAndInstall()
  })
}

/**
 * Puts the app back as it was before Restart, so Restart can be tried again.
 * The windows destroyed for the install are built again on the next click.
 */
function abandonInstall(): void {
  clearTimeout(installTimer)
  installing = false
  cancelQuit()
  void report(
    `${appName} could not install the update`,
    'Try again later. If the app is not in the Applications folder, move it there first.',
  )
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

/**
 * Points Squirrel at a server answering with `update`, starting the server
 * the first time. The server and its URL stay up for the life of the app
 * because Electron builds a new Squirrel updater object on every `setFeedURL`,
 * and a new one deletes every update directory at its first check, the staged
 * update's included. Only the updater that staged an update keeps it.
 */
async function offer(update: AvailableUpdate): Promise<void> {
  offered = update
  if (feedServer) return
  const server = createServer((_request, response) => {
    if (!offered) {
      response.writeHead(204)
      response.end()
      return
    }
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ url: offered.url, name: offered.version }))
  })
  const url = await new Promise<string>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`)
    })
  })
  feedServer = server
  autoUpdater.setFeedURL({ url })
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

/** A staged update keeps Restart on offer while a newer one downloads. */
function show(): void {
  state = staged ? { status: 'ready', version: staged } : (work ?? { status: 'idle' })
  changed(state)
}
