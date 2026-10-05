/*
 * The two windows: a tray popover and the main window.
 *
 * Closing the main window hides it rather than destroying it, so the app
 * carries on in the tray. Everything that would otherwise quit is routed
 * through `beginQuit`, the only path that sets the flag those handlers check.
 */

import { app, BrowserWindow, screen, shell, type Rectangle, type WebContents } from 'electron'
import { join } from 'node:path'

import { log } from './log'

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
 * Reports a window that came up empty.
 *
 * A renderer that throws while loading still counts as a successful page load,
 * so the window opens, paints its background and shows nothing. Without these
 * the only trace is a line in the dev server's output.
 */
function watchForFailure(window: BrowserWindow, which: string): void {
  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    log.error('window', 'load_failed', { window: which, url, description, code })
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    log.error('window', 'renderer_gone', { window: which, reason: details.reason })
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

export function createMainWindow(): BrowserWindow {
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
    // Same material as the popover, so the two read as one surface.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    transparent: process.platform === 'darwin',
    vibrancy: process.platform === 'darwin' ? 'popover' : undefined,
    backgroundColor: process.platform === 'darwin' ? undefined : '#1c1c1e',
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

  // Hide rather than close, so the app stays alive in the tray. On macOS the
  // dock tile is dropped too, otherwise the app looks running with no window.
  window.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    window.hide()
    if (process.platform === 'darwin') app.dock?.hide()
    // The page keeps running while hidden and cannot tell this from being
    // covered by another window, which also reads as hidden to it. It is told,
    // so it can leave a screen that should not be there at the next open.
    window.webContents.send('window:closed')
  })

  window.webContents.setWindowOpenHandler(({ url }) => openExternally(url))

  load(window, 'main')
  mainWindow = window
  return window
}

/**
 * Hides the window through its own close handler, so the dock tile goes with it
 * rather than leaving the app looking like it still has a window open.
 */
export function hideMainWindow(): void {
  mainWindow?.close()
}

export function showMainWindow(): void {
  const window = createMainWindow()
  if (process.platform === 'darwin') void app.dock?.show()
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
  const bounds = window.getBounds()
  if (bounds.width === width) return
  const area = screen.getDisplayMatching(bounds).workArea
  const centred = Math.round(bounds.x + (bounds.width - width) / 2)
  const x = Math.max(area.x, Math.min(centred, area.x + area.width - width))
  window.setBounds({ ...bounds, x, width }, false)
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
    transparent: process.platform === 'darwin',
    vibrancy: process.platform === 'darwin' ? 'popover' : undefined,
    backgroundColor: process.platform === 'darwin' ? undefined : '#1c1c1e',
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
  const window = createPopover()
  if (window.isVisible()) {
    window.hide()
    return
  }
  lastTrayBounds = hasGeometry(trayBounds)
    ? trayBounds
    : { ...screen.getCursorScreenPoint(), width: 0, height: 0 }
  placePopover(window, lastTrayBounds)
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
  const x = Math.min(Math.max(centred, area.x + 8), area.x + area.width - POPOVER_WIDTH - 8)

  // Below the icon when the tray sits at the top of the screen, above it when
  // the taskbar is at the bottom.
  const below = trayBounds.y + trayBounds.height + POPOVER_GAP
  const y =
    below + height > area.y + area.height
      ? Math.max(area.y + 8, trayBounds.y - height - POPOVER_GAP)
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
  const [width] = window.getSize()
  const clamped = Math.max(MIN_HEIGHT, Math.min(Math.ceil(height), MAX_HEIGHT))
  if (window.getSize()[1] !== clamped) {
    window.setSize(width, clamped, false)
    if (window === popover && lastTrayBounds) placePopover(window, lastTrayBounds)
  }
  if (window === mainWindow && !mainSized) {
    mainSized = true
    revealMainWindow()
  }
}

export function hidePopover(): void {
  popover?.hide()
}

export function broadcast(channel: string, payload: unknown): void {
  for (const window of [mainWindow, popover]) {
    if (window && !window.isDestroyed()) window.webContents.send(channel, payload)
  }
}
