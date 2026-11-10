/*
 * The two windows: a tray popover and the main window.
 *
 * Closing the main window hides it rather than destroying it, so the app
 * carries on in the tray. Everything that would otherwise quit is routed
 * through `beginQuit`, the only path that sets the flag those handlers check.
 */

import { BrowserWindow, screen, shell, type Rectangle, type WebContents } from 'electron'
import { join } from 'node:path'

import { log } from './log'
import { windowChrome } from './platform'

const chrome = windowChrome()

/**
 * The renderer runs with no Node and no direct filesystem: everything it can
 * reach goes through the preload bridge.
 */
const RENDERER_PREFERENCES = {
  preload: join(__dirname, '../preload/index.js'),
  contextIsolation: true,
  nodeIntegration: false,
}

const POPOVER_WIDTH = 300
/**
 * The window's two widths. The status view is one column of rows. Onboarding
 * is a column of words beside a stage for what the words are about.
 */
const LAYOUT_WIDTH = { status: 400, onboarding: 880 } as const
/**
 * How long a new window waits for the renderer to report its size before it
 * is shown anyway. A renderer that failed to load never reports, and a window
 * that never appears would hide that.
 */
const SIZE_GRACE_MS = 1_500
/** Bounds on the content-driven height, so a broken measurement cannot fill the screen. */
const MIN_HEIGHT = 180
const MAX_HEIGHT = 720
/** A starting height only: both windows resize to what the content reports. */
const POPOVER_HEIGHT = 320
/** Gap between the menu bar item and the popover's top edge. */
const POPOVER_GAP = 6
/** How far the popover keeps from the edges of the screen other than the tray's. */
const POPOVER_MARGIN = 8
/**
 * How many times one window reloads a dead page within `RELOAD_WINDOW_MS`.
 * A page that kills its own renderer as it loads would otherwise reload in a
 * loop.
 */
const MAX_RELOADS = 3
const RELOAD_WINDOW_MS = 60_000

let mainWindow: BrowserWindow | null = null
/** Set once the renderer has reported the main window's size. Until then it is not shown. */
let mainSized = false
/** Someone has asked to see the main window before it had its size. */
let showWhenSized = false
let popover: BrowserWindow | null = null
let quitting = false
/** Set while a menu the popover opened holds the focus. See `holdPopover`. */
let held = false
/** Kept so a resized popover can be re-anchored to the icon it opened from. */
let lastTrayBounds: Rectangle | null = null

/** The one path that lets the app actually exit. */
export function beginQuit(): void {
  quitting = true
}

/** For a quit that did not happen, so closing the window hides it again. */
export function cancelQuit(): void {
  quitting = false
}

function rendererEntry(hash: string): { url?: string; file?: string; hash: string } {
  const dev = process.env.ELECTRON_RENDERER_URL
  return dev
    ? { url: `${dev}#${hash}`, hash }
    : { file: join(__dirname, '../renderer/index.html'), hash }
}

function load(window: BrowserWindow, hash: string): void {
  const entry = rendererEntry(hash)
  if (entry.url) void window.loadURL(entry.url)
  else void window.loadFile(entry.file as string, { hash })
}

/**
 * Sends a link to the browser instead of opening a window for it.
 *
 * Only web schemes: `openExternal` will hand `file:` to Finder and `shell:` to
 * whatever claims it, so an unchecked URL is a way out of the sandbox the
 * renderer is otherwise held to.
 */
export function openWebUrl(url: string): Promise<void> | null {
  try {
    if (/^https?:$/.test(new URL(url).protocol)) return shell.openExternal(url)
  } catch {
    // An unparseable URL is not one worth opening.
  }
  return null
}

/** The window-open form: the handler must answer synchronously, so a browser
 * that fails to launch can only be dropped here, not reported. */
export function openExternally(url: string): { action: 'deny' } {
  void openWebUrl(url)?.catch(() => {})
  return { action: 'deny' }
}

/**
 * Reports a window that came up empty, and reloads one whose page died.
 *
 * A renderer that throws while loading still counts as a successful page load,
 * so the window opens, paints its background and shows nothing. Without these
 * the only trace is a line in the dev server's output.
 */
function watchForFailure(window: BrowserWindow, which: string): void {
  let reloads: number[] = []
  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    log.error('window', 'load_failed', { window: which, url, description, code })
  })
  // Electron keeps the window after its renderer dies, so it opens on an empty
  // background until the app is quit. The renderer is a separate process
  // that a crash, running out of memory or any `pkill` matching its command
  // line can end while the app stays in the menu bar for weeks.
  window.webContents.on('render-process-gone', (_event, details) => {
    log.error('window', 'renderer_gone', { window: which, reason: details.reason })
    if (details.reason === 'clean-exit' || window.isDestroyed()) return
    const now = Date.now()
    reloads = reloads.filter((at) => now - at < RELOAD_WINDOW_MS)
    if (reloads.length >= MAX_RELOADS) {
      log.error('window', 'gave_up_reloading', { window: which })
      return
    }
    reloads.push(now)
    log.info('window', 'reloading', { window: which })
    window.webContents.reload()
  })
  window.webContents.on('preload-error', (_event, path, error) => {
    log.error('window', 'preload_failed', { window: which, path, error })
  })
  window.webContents.on('console-message', ({ level, message, lineNumber, sourceId }) => {
    if (level === 'error')
      log.error('window', 'renderer_error', {
        window: which,
        message,
        source: sourceId,
        line: lineNumber,
      })
  })
}

function createMainWindow(): BrowserWindow {
  // A window the OS destroyed under us would otherwise be handed back and shown.
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow

  const window = new BrowserWindow({
    width: LAYOUT_WIDTH.status,
    height: POPOVER_HEIGHT,
    show: false,
    autoHideMenuBar: true,
    // The width is fixed and the height follows the content, so a size the
    // user dragged out would be undone by the next row that appears, and a
    // full screen would be mostly empty around it.
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    // Sizes are the page's, so a title bar the OS adds sits outside them
    // rather than covering the bottom of the content.
    useContentSize: true,
    ...chrome.mainWindow(),
    webPreferences: RENDERER_PREFERENCES,
  })

  watchForFailure(window, 'window')
  // Not shown as soon as it can paint. It opens at a guessed size, and the
  // renderer picks between two widths and a height once it knows what it is
  // showing, so showing it now would draw the window and then jump it.
  // `resizeToContent` shows it at its first report.
  mainSized = false
  showWhenSized = true
  window.once('ready-to-show', () => {
    setTimeout(() => {
      if (window !== mainWindow || mainSized) return
      mainSized = true
      revealMainWindow()
    }, SIZE_GRACE_MS)
  })

  // Hide rather than close, so the app stays alive in the tray.
  window.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    window.hide()
    chrome.windowsHidden()
    // The page keeps running while hidden and cannot tell this from being
    // covered by another window, which also reads as hidden to it. It is told,
    // so it can leave a screen that should not be there at the next open.
    window.webContents.send('window:closed')
  })

  window.on('moved', () => fitHeight(window))

  window.webContents.setWindowOpenHandler(({ url }) => openExternally(url))
  // A destroyed window throws on every call, and a failed update install
  // leaves the app running after destroying it. See `destroyAllWindows`.
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })

  load(window, 'main')
  mainWindow = window
  return window
}

/**
 * Destroys every window and resolves once Electron has dropped them all from
 * its window list. A window leaves that list just after its 'closed' handlers
 * return, so the last one resolves on the following turn. `destroy` is
 * guaranteed to emit 'closed' and never runs the close handler.
 */
export function destroyAllWindows(): Promise<void> {
  const open = BrowserWindow.getAllWindows()
  if (open.length === 0) return Promise.resolve()
  return new Promise((resolve) => {
    let left = open.length
    for (const window of open) {
      window.once('closed', () => {
        left -= 1
        if (left === 0) setImmediate(resolve)
      })
      window.destroy()
    }
  })
}

/**
 * Hides the window through its own close handler, so the dock tile goes with it
 * rather than leaving the app looking like it still has a window open.
 */
export function hideMainWindow(): void {
  mainWindow?.close()
}

export function showMainWindow(): void {
  // An update installs only once no window is open, so none opens after a
  // quit has begun. See `installUpdate`.
  if (quitting) return
  const window = createMainWindow()
  chrome.windowShown()
  if (window.isMinimized()) window.restore()
  showWhenSized = true
  revealMainWindow()
}

/** Shows the main window if it has been asked for and has its size. */
function revealMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed() || !mainSized || !showWhenSized) return
  showWhenSized = false
  mainWindow.show()
  mainWindow.focus()
}

/**
 * Sets the main window to the width of what it is about to show. It widens
 * and narrows around its own centre, so going from onboarding to the status
 * view shrinks it in place rather than toward its left edge.
 */
export function layoutMainWindow(sender: WebContents, layout: unknown): void {
  const window = BrowserWindow.fromWebContents(sender)
  if (!window || window !== mainWindow || window.isDestroyed()) return
  if (layout !== 'status' && layout !== 'onboarding') return
  const width = LAYOUT_WIDTH[layout]
  const bounds = window.getContentBounds()
  if (bounds.width === width) return
  const area = screen.getDisplayMatching(bounds).workArea
  const centred = Math.round(bounds.x + (bounds.width - width) / 2)
  const x = Math.max(area.x, Math.min(centred, area.x + area.width - width))
  window.setContentBounds({ ...bounds, x, width }, false)
}

export function createPopover(): BrowserWindow {
  if (popover && !popover.isDestroyed()) return popover

  const window = new BrowserWindow({
    width: POPOVER_WIDTH,
    height: POPOVER_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    // Keeps the popover out of the window cycle and off the dock, so it behaves
    // like a menu rather than a window.
    fullscreenable: false,
    useContentSize: true,
    ...chrome.popover(),
    webPreferences: RENDERER_PREFERENCES,
  })

  watchForFailure(window, 'popover')

  // Dismiss on focus loss, the way a menu does. Guarded in dev against devtools
  // focus, and while something the popover opened holds it instead.
  window.on('blur', () => {
    if (held) return
    if (!window.webContents.isDevToolsOpened()) window.hide()
  })

  window.webContents.setWindowOpenHandler(({ url }) => openExternally(url))
  // Dropped for the reason `createMainWindow` gives.
  window.on('closed', () => {
    if (popover === window) popover = null
  })

  load(window, 'popover')
  popover = window
  return window
}

/**
 * Keeps the popover up while something it opened takes the focus, and returns
 * the release. Without it, opening a menu dismisses the surface the menu is
 * about, and the menu is left pointing at nothing.
 */
export function holdPopover(): () => void {
  held = true
  return () => {
    held = false
    // The blur that would have hidden the popover may have fired while held,
    // e.g. when the menu closed by a switch to another app, so it is replayed
    // rather than waiting for a focus change that is not coming.
    if (popover && !popover.isDestroyed() && !popover.isFocused()) popover.hide()
  }
}

/**
 * Positions the popover under the tray icon and shows it.
 *
 * A tray host that reports no geometry leaves the pointer as the only anchor,
 * and it is read now rather than at the resize that follows the first render,
 * by which time it has moved and the window would chase it.
 */
export function togglePopover(trayBounds: Rectangle): void {
  // No window opens once a quit has begun. See `showMainWindow`.
  if (quitting) return
  const window = createPopover()
  if (window.isVisible()) {
    window.hide()
    return
  }
  lastTrayBounds = hasGeometry(trayBounds)
    ? trayBounds
    : { ...screen.getCursorScreenPoint(), width: 0, height: 0 }
  placePopover(window, lastTrayBounds)
  fitHeight(window)
  window.show()
  window.focus()
}

/** A tray host that reports no geometry gives back a zero-sized rectangle. */
function hasGeometry(bounds: Rectangle | null): bounds is Rectangle {
  return Boolean(bounds && (bounds.width > 0 || bounds.height > 0))
}

/**
 * Puts the popover under the tray icon, clamped to the display it is on.
 *
 * Called again after a resize, because a window that grew downwards would
 * otherwise hang off the bottom of the screen.
 */
function placePopover(window: BrowserWindow, trayBounds: Rectangle): void {
  const height = window.getSize()[1]
  // A zero-sized rectangle is the cursor point `togglePopover` resolved, and
  // reads the same as an icon of no width.
  const anchor = { x: Math.round(trayBounds.x + trayBounds.width / 2), y: trayBounds.y }
  const area = screen.getDisplayNearestPoint(anchor).workArea

  const centred = Math.round(anchor.x - POPOVER_WIDTH / 2)
  const x = Math.min(
    Math.max(centred, area.x + POPOVER_MARGIN),
    area.x + area.width - POPOVER_WIDTH - POPOVER_MARGIN,
  )

  // Below the icon when the tray sits at the top of the screen. When the
  // taskbar is at the bottom it rests on the taskbar rather than on the icon:
  // Windows can keep the icon in the overflow panel above the taskbar, which
  // closes as the popover opens, and a popover placed against the icon would
  // be left floating where the panel was.
  const below = trayBounds.y + trayBounds.height + POPOVER_GAP
  const bottom = area.y + area.height
  const y =
    below + height > bottom
      ? Math.max(area.y + POPOVER_MARGIN, bottom - height - POPOVER_GAP)
      : below

  window.setPosition(x, y, false)
}

/**
 * Sizes a window to the height its content reported.
 *
 * The popover behaves like a menu: it is exactly as tall as what it shows, so a
 * line that only appears while something is wrong leaves no gap once it is
 * gone. The window follows the same rule, so sign-in, setup and the status
 * view each get the height they need without one being set for them.
 */
export function resizeToContent(sender: WebContents, height: number): void {
  const window = BrowserWindow.fromWebContents(sender)
  if (!window || window.isDestroyed()) return
  requestedHeight.set(window, height)
  fitHeight(window)
  if (window === mainWindow && !mainSized) {
    mainSized = true
    revealMainWindow()
  }
}

/** The height each window's page last asked for, before the screen capped it. */
const requestedHeight = new WeakMap<BrowserWindow, number>()

/**
 * Sizes a window to the height its page asked for, within the display it is
 * on. The page reports its height only when that changes, so this runs again
 * when the window moves to another display and when the popover opens, or a
 * cap from a shorter display would stay after a move to a taller one.
 */
function fitHeight(window: BrowserWindow): void {
  const height = requestedHeight.get(window)
  if (height === undefined) return
  const [width, current] = window.getContentSize()
  // Never taller than the screen leaves room for, counting the title bar the
  // OS draws outside the content, or the bottom of the page would sit under
  // the taskbar or off the screen. The page scrolls instead.
  const frame = window.getSize()[1] - current
  // The popover also keeps its margin from the top and its gap from the tray.
  const inset = window === popover ? POPOVER_MARGIN + POPOVER_GAP : 0
  const area = screen.getDisplayMatching(window.getBounds()).workArea
  const room = area.height - frame - inset
  const clamped = Math.max(MIN_HEIGHT, Math.min(Math.ceil(height), MAX_HEIGHT, room))
  if (current === clamped) return
  window.setContentSize(width, clamped, false)
  if (window === popover && lastTrayBounds) placePopover(window, lastTrayBounds)
  else keepOnScreen(window, area)
}

/** Moves a window that grew past the bottom of the work area back up into it. */
function keepOnScreen(window: BrowserWindow, area: Rectangle): void {
  const bounds = window.getBounds()
  const overflow = bounds.y + bounds.height - (area.y + area.height)
  if (overflow > 0) window.setPosition(bounds.x, Math.max(area.y, bounds.y - overflow), false)
}

export function hidePopover(): void {
  popover?.hide()
}

export function broadcast(channel: string, payload: unknown): void {
  for (const window of [mainWindow, popover]) {
    if (window && !window.isDestroyed()) window.webContents.send(channel, payload)
  }
}
