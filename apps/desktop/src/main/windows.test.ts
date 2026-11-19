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
  /** The main window gets a title bar from the OS, the frameless popover none. */
  readonly titleBar: number
  content = { width: 320, height: 320 }
  position = { x: 0, y: 200 }
  constructor(options: { frame?: boolean }) {
    super()
    this.titleBar = options.frame === false ? 0 : 30
  }
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
  getSize = () => [this.content.width, this.content.height + this.titleBar]
  getContentSize = () => [this.content.width, this.content.height]
  getBounds = () => ({ ...this.position, width: this.content.width, height: this.getSize()[1] })
  setContentSize = (width: number, height: number) => {
    this.content = { width, height }
  }
  setPosition = (x: number, y: number) => {
    this.position = { x, y }
  }
  /** Electron emits 'closed' for a destroyed window, and runs no close handler. */
  destroy = () => {
    this.destroyed = true
    this.emit('closed')
  }
}

const built: FakeWindow[] = []
let workArea = { x: 0, y: 0, width: 1440, height: 900 }

mock.module('electron', () => ({
  app: { dock: { show: async () => {}, hide: () => {} } },
  BrowserWindow: class {
    constructor(options: { frame?: boolean }) {
      const window = new FakeWindow(options)
      built.push(window)
      return window
    }
    static getAllWindows = () => built.filter((window) => !window.destroyed)
    static fromWebContents = (contents: unknown) =>
      built.find((window) => window.webContents === contents) ?? null
  },
  screen: {
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    getDisplayNearestPoint: () => ({ workArea }),
    getDisplayMatching: () => ({ workArea }),
  },
  shell: { openExternal: async () => {} },
}))
mock.module('./log', () => ({ log: { info: () => {}, error: () => {} } }))
mock.module('./platform', () => ({
  windowChrome: () => ({
    mainWindow: () => ({}),
    popover: () => ({}),
    windowShown: () => {},
    windowsHidden: () => {},
    trayImage: () => ({}),
  }),
}))

const {
  beginQuit,
  cancelQuit,
  destroyAllWindows,
  hideMainWindow,
  hidePopover,
  resizeToContent,
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

describe('the main window sized to its page', () => {
  it('is no taller than the work area leaves room for, title bar included, and moves up into it', () => {
    showMainWindow()
    const window = built.find((w) => !w.destroyed && w.titleBar > 0)
    if (!window) throw new Error('no main window')
    workArea = { x: 0, y: 0, width: 1024, height: 600 }

    resizeToContent(window.webContents as never, 700)

    expect(window.getContentSize()).toEqual([320, 570])
    expect(window.getBounds().y).toBe(0)
  })

  it('takes the height its page asked for once moved to a taller display', () => {
    const window = built.find((w) => !w.destroyed && w.titleBar > 0)
    if (!window) throw new Error('no main window')
    workArea = { x: 0, y: 0, width: 1440, height: 900 }

    window.emit('moved')

    expect(window.getContentSize()).toEqual([320, 700])
  })
})

describe('the popover', () => {
  it('rests on a taskbar at the bottom when its icon is in the overflow panel above it', () => {
    hidePopover()
    workArea = { x: 0, y: 0, width: 1024, height: 720 }

    togglePopover({ x: 790, y: 665, width: 32, height: 32 })

    const popover = [...built].reverse().find((w) => !w.destroyed && w.titleBar === 0)
    if (!popover) throw new Error('no popover')
    expect(popover.getBounds().y + popover.getBounds().height).toBe(720 - 6)
  })

  it('opens at the height its page asked for on a display taller than the last one', () => {
    const popover = [...built].reverse().find((w) => !w.destroyed && w.titleBar === 0)
    if (!popover) throw new Error('no popover')
    workArea = { x: 0, y: 0, width: 1024, height: 400 }
    resizeToContent(popover.webContents as never, 600)
    // The 8px margin from the top and the 6px gap from the tray.
    expect(popover.getContentSize()[1]).toBe(386)
    const { y, height } = popover.getBounds()
    expect(y).toBeGreaterThanOrEqual(0)
    expect(y + height).toBeLessThanOrEqual(400)
    hidePopover()

    workArea = { x: 0, y: 0, width: 1440, height: 900 }
    togglePopover(TRAY)

    expect(popover.getContentSize()[1]).toBe(600)
  })
})
