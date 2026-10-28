import { describe, expect, it, mock } from 'bun:test'
import { EventEmitter } from 'node:events'

/*
 * Which windows open once a quit has begun, against a stand-in for Electron's
 * BrowserWindow that records each one built. The module keeps its windows
 * between tests, so they run in order.
 *
 * The package's test script runs this file in a bun process of its own, for
 * the reason `updates.test.ts` gives: another file's Electron mock, linked
 * first, has no BrowserWindow.
 */

class FakeWindow extends EventEmitter {
  destroyed = false
  visible = false
  /** Electron throws on any call to a destroyed window. */
  private alive = () => {
    if (this.destroyed) throw new TypeError('Object has been destroyed')
  }
  webContents = Object.assign(new EventEmitter(), {
    setWindowOpenHandler: () => {},
    send: () => {},
    isDevToolsOpened: () => false,
  })
  isDestroyed = () => this.destroyed
  isMinimized = () => (this.alive(), false)
  isVisible = () => (this.alive(), this.visible)
  isFocused = () => (this.alive(), this.visible)
  show = () => (this.alive(), (this.visible = true))
  hide = () => (this.alive(), (this.visible = false))
  focus = () => this.alive()
  close = () => this.alive()
  loadFile = async () => {}
  loadURL = async () => {}
  getSize = () => [320, 320]
  setBounds = () => {}
  setPosition = () => {}
  /** Electron emits 'closed' for a destroyed window, and runs no close handler. */
  destroy = () => {
    this.destroyed = true
    this.emit('closed')
  }
}

const built: FakeWindow[] = []

mock.module('electron', () => ({
  app: { dock: { show: async () => {}, hide: () => {} } },
  BrowserWindow: class {
    constructor() {
      const window = new FakeWindow()
      built.push(window)
      return window
    }
    static getAllWindows = () => built.filter((window) => !window.destroyed)
  },
  screen: {
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }),
  },
  shell: { openExternal: async () => {} },
}))
mock.module('./log', () => ({ log: { info: () => {}, error: () => {} } }))

const {
  beginQuit,
  cancelQuit,
  destroyAllWindows,
  hideMainWindow,
  hidePopover,
  showMainWindow,
  togglePopover,
} = await import('./windows')

const TRAY = { x: 100, y: 0, width: 22, height: 22 }

describe('windows once a quit has begun', () => {
  it('opens the main window and the popover before any quit', () => {
    showMainWindow()
    togglePopover(TRAY)
    expect(built).toHaveLength(2)
  })

  it('opens no window after an update install has destroyed them all', async () => {
    // What Restart does before handing over to Squirrel.
    beginQuit()
    await destroyAllWindows()
    expect(built.every((window) => window.destroyed)).toBe(true)

    // The update notification's click also activates the app, which asks
    // for the main window, and the tray can still be clicked.
    showMainWindow()
    togglePopover(TRAY)
    expect(built).toHaveLength(2)
  })

  it('touches no destroyed window and opens new ones after an install fails', () => {
    cancelQuit()

    // What a right-click on the tray and a closed window call first.
    expect(() => hidePopover()).not.toThrow()
    expect(() => hideMainWindow()).not.toThrow()

    showMainWindow()
    togglePopover(TRAY)
    expect(built).toHaveLength(4)
    expect(built.slice(2).every((window) => !window.destroyed)).toBe(true)
  })
})
