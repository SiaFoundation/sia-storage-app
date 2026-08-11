/*
 * The two windows: a tray popover and the main window.
 *
 * Closing the main window hides it rather than destroying it, on every
 * platform, so the app carries on in the tray. Everything that would otherwise
 * quit the app is routed through `beginQuit`, which is the only path that sets
 * the flag those handlers check.
 */

import { app, BrowserWindow, screen, shell, type Rectangle, type WebContents } from 'electron'
import { join } from 'node:path'

const POPOVER_WIDTH = 300
/** The window shows the same status view, so it is sized for it, not for a library. */
const WINDOW_WIDTH = 320
/** Bounds on the content-driven height, so a broken measurement cannot fill the screen. */
const MIN_HEIGHT = 180
const MAX_HEIGHT = 720
/** A starting height only: both windows resize to what the content reports. */
const POPOVER_HEIGHT = 320
/** Gap between the menu bar item and the popover's top edge. */
const POPOVER_GAP = 6

let mainWindow: BrowserWindow | null = null
let popover: BrowserWindow | null = null
let quitting = false
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
function openExternally(url: string): { action: 'deny' } {
  try {
    if (/^https?:$/.test(new URL(url).protocol)) void shell.openExternal(url)
  } catch {
    // An unparseable URL is not one worth opening.
  }
  return { action: 'deny' }
}

export function createMainWindow(): BrowserWindow {
  // A window the OS destroyed under us would otherwise be handed back and shown.
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow

  const window = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: POPOVER_HEIGHT,
    show: false,
    autoHideMenuBar: true,
    // Same material as the popover, so the two read as one surface. The window
    // stays small because it shows the status view and nothing else yet.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    transparent: process.platform === 'darwin',
    vibrancy: process.platform === 'darwin' ? 'popover' : undefined,
    backgroundColor: process.platform === 'darwin' ? undefined : '#1c1c1e',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  window.on('ready-to-show', () => window.show())

  // Hide rather than close, so the app stays alive in the tray. On macOS the
  // dock tile is dropped too, otherwise the app looks running with no window.
  window.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    window.hide()
    if (process.platform === 'darwin') app.dock?.hide()
  })

  window.webContents.setWindowOpenHandler(({ url }) => openExternally(url))

  load(window, 'main')
  mainWindow = window
  return window
}

export function showMainWindow(): void {
  const window = createMainWindow()
  if (process.platform === 'darwin') void app.dock?.show()
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
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
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Dismiss on focus loss, the way a menu does. Guarded in dev so devtools
  // focus does not fight it.
  window.on('blur', () => {
    if (!window.webContents.isDevToolsOpened()) window.hide()
  })

  window.webContents.setWindowOpenHandler(({ url }) => openExternally(url))

  load(window, 'popover')
  popover = window
  return window
}

/**
 * Positions the popover under the tray icon and shows it.
 *
 * `trayBounds` is empty on some Linux desktops, where the tray host reports no
 * geometry, so the cursor's display is used as a fallback rather than placing
 * the window at the origin.
 */
export function togglePopover(trayBounds: Rectangle): void {
  const window = createPopover()
  if (window.isVisible()) {
    window.hide()
    return
  }
  lastTrayBounds = trayBounds
  placePopover(window, trayBounds)
  window.show()
  window.focus()
}

/**
 * Puts the popover under the tray icon, clamped to the display it is on.
 *
 * Called again after a resize, because a window that grew downwards would
 * otherwise hang off the bottom of the screen.
 */
function placePopover(window: BrowserWindow, trayBounds: Rectangle | null): void {
  const height = window.getSize()[1]
  const hasBounds = Boolean(trayBounds && (trayBounds.width > 0 || trayBounds.height > 0))
  const anchor =
    hasBounds && trayBounds
      ? { x: Math.round(trayBounds.x + trayBounds.width / 2), y: trayBounds.y }
      : screen.getCursorScreenPoint()
  const area = screen.getDisplayNearestPoint(anchor).workArea

  const centred = Math.round(anchor.x - POPOVER_WIDTH / 2)
  const x = Math.min(Math.max(centred, area.x + 8), area.x + area.width - POPOVER_WIDTH - 8)

  // Below the icon when the tray sits at the top of the screen, above it when
  // the taskbar is at the bottom.
  const below =
    hasBounds && trayBounds ? trayBounds.y + trayBounds.height + POPOVER_GAP : area.y + POPOVER_GAP
  const y =
    below + height > area.y + area.height
      ? Math.max(
          area.y + 8,
          (hasBounds && trayBounds ? trayBounds.y : area.y + area.height) - height - POPOVER_GAP,
        )
      : below

  window.setPosition(x, y, false)
}

/**
 * Sizes a window to the height its content reported.
 *
 * The popover behaves like a menu: it is exactly as tall as what it shows, so a
 * section that only appears mid-transfer leaves no gap once it is gone. The
 * window follows the same rule while it shows the same content.
 */
export function resizeToContent(sender: WebContents, height: number): void {
  const window = BrowserWindow.fromWebContents(sender)
  if (!window || window.isDestroyed()) return
  const [width] = window.getSize()
  const clamped = Math.max(MIN_HEIGHT, Math.min(Math.ceil(height), MAX_HEIGHT))
  if (window.getSize()[1] === clamped) return
  window.setSize(width, clamped, false)
  if (window === popover) placePopover(window, lastTrayBounds)
}

export function hidePopover(): void {
  popover?.hide()
}

export function broadcast(channel: string, payload: unknown): void {
  for (const window of [mainWindow, popover]) {
    if (window && !window.isDestroyed()) window.webContents.send(channel, payload)
  }
}
