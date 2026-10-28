import { beforeAll, describe, expect, it, jest, mock } from 'bun:test'
import { EventEmitter } from 'node:events'

/*
 * The updater's states against a stand-in for Electron's autoUpdater, which
 * only emits what the test tells it to. The module keeps its state between
 * tests, so they run in order: a stalled check, a staged update, a background
 * check that leaves it alone, a failed newer download, then installs that
 * fail, stall, and go through.
 *
 * The package's test script runs this file in a bun process of its own. Bun
 * shares `mock.module` across the files of one run, and once another file's
 * Electron mock is linked without `autoUpdater`, importing the updater fails.
 */

const calls: string[] = []
const updater = Object.assign(new EventEmitter(), {
  setFeedURL: mock(() => {}),
  checkForUpdates: mock(() => {}),
  quitAndInstall: mock(() => calls.push('quitAndInstall')),
})
let respond: () => Promise<unknown> = async () => Response.json([])
const fetched = mock(() => respond())
/** Stands in for `app`, which the updater listens on for the quit. */
const appEvents = new EventEmitter()
const showMessageBox = mock(async () => ({ response: 0 }))
/** Every notification shown, with the handler its click runs. */
const notifications: Array<{ body: string; click?: () => void }> = []
class FakeNotification {
  static isSupported = () => true
  private shown: { body: string; click?: () => void }
  constructor(options: { body: string }) {
    this.shown = { body: options.body }
    notifications.push(this.shown)
  }
  on(_event: 'click', handler: () => void) {
    this.shown.click = handler
  }
  show() {}
}

mock.module('electron', () => ({
  app: {
    on: appEvents.on.bind(appEvents),
    isPackaged: true,
    getVersion: () => '1.0.0',
    getName: () => 'sia.storage.desktop.beta',
    focus: () => {},
  },
  autoUpdater: updater,
  dialog: { showMessageBox },
  net: { fetch: fetched },
  Notification: FakeNotification,
}))
mock.module('./log', () => ({ log: { info: () => {}, error: () => {} } }))
mock.module('./windows', () => ({
  beginQuit: () => calls.push('beginQuit'),
  cancelQuit: () => calls.push('cancelQuit'),
  destroyAllWindows: async () => {
    calls.push('destroyAllWindows')
  },
}))

const { checkForUpdates, installUpdate, startUpdates, updateState } = await import('./updates')

/**
 * Lets the install's wait for the windows to be destroyed finish. Promise
 * callbacks only, so it works under fake timers too.
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

/** A feed holding one beta release of `version`, with its zip. */
function feedOffering(version: string): () => Promise<unknown> {
  const name = `Sia-Storage-Beta-${version}-arm64.zip`
  return async () =>
    Response.json([
      {
        tag_name: `desktop/v${version}`,
        draft: false,
        assets: [{ name, browser_download_url: `https://example.test/${name}` }],
      },
    ])
}

beforeAll(() => {
  // Registered under fake timers, so the first check and the four-hour
  // interval never fire on their own. Real timers come back at once, because
  // fake ones also hold the callback of the feed server's listen.
  jest.useFakeTimers()
  startUpdates(
    {
      domainId: 'sia-beta',
      displayName: 'Sia Storage Beta',
      extensionBundleId: 'sia.storage.desktop.beta.file-provider',
      updates: { channel: 'beta', asset: 'Sia-Storage-Beta-{version}-arm64.zip' },
    },
    () => {},
  )
  jest.useRealTimers()
})

describe('the updater', () => {
  it('ends a check whose response stalls, so later checks can run', async () => {
    jest.useFakeTimers()
    respond = async () => ({ ok: true, json: () => new Promise(() => {}) })
    const check = checkForUpdates(false)
    expect(updateState()).toEqual({ status: 'checking' })

    jest.advanceTimersByTime(60_000)
    jest.useRealTimers()
    // Bounded, so a check that never ends fails the assertion below instead
    // of hanging the run.
    await Promise.race([check, Bun.sleep(100)])

    expect(updateState()).toEqual({ status: 'idle' })
  })

  it('is ready to restart once Squirrel has staged the download', async () => {
    respond = feedOffering('1.1.0')
    await checkForUpdates(false)
    expect(updateState()).toEqual({ status: 'downloading', version: '1.1.0' })
    expect(updater.setFeedURL).toHaveBeenCalledTimes(1)

    updater.emit('update-downloaded')

    expect(updateState()).toEqual({ status: 'ready', version: '1.1.0' })
    expect(notifications.map((n) => n.body)).toEqual([
      'Restart Sia Storage Beta to install version 1.1.0.',
    ])
  })

  it('leaves a staged update alone on a background check, so Restart stays offered', async () => {
    respond = feedOffering('1.2.0')
    fetched.mockClear()

    await checkForUpdates(false)

    expect(fetched).not.toHaveBeenCalled()
    expect(updateState()).toEqual({ status: 'ready', version: '1.1.0' })
  })

  it('keeps the staged update, and says so, when a newer download the user asked for fails', async () => {
    respond = feedOffering('1.2.0')
    await checkForUpdates(true)
    expect(updateState()).toEqual({ status: 'downloading', version: '1.2.0' })
    showMessageBox.mockClear()

    updater.emit('error', new Error('connection reset'))

    expect(updateState()).toEqual({ status: 'ready', version: '1.1.0' })
    expect(showMessageBox).toHaveBeenCalledTimes(1)
  })

  it('restarts from the notification, handing over to Squirrel only once the windows are gone, and undoes it when the install fails', async () => {
    notifications[0]!.click!()
    expect(calls).toEqual(['beginQuit', 'destroyAllWindows'])
    await settle()
    expect(calls).toEqual(['beginQuit', 'destroyAllWindows', 'quitAndInstall'])
    fetched.mockClear()
    await checkForUpdates(true)
    expect(fetched).not.toHaveBeenCalled()
    showMessageBox.mockClear()

    updater.emit('error', new Error('read-only volume'))

    expect(calls).toEqual(['beginQuit', 'destroyAllWindows', 'quitAndInstall', 'cancelQuit'])
    expect(updateState()).toEqual({ status: 'ready', version: '1.1.0' })
    expect(showMessageBox).toHaveBeenCalledTimes(1)
  })

  it('gives up on an install Squirrel never quits for, says so, and lets Restart try again', async () => {
    calls.length = 0
    showMessageBox.mockClear()
    jest.useFakeTimers()
    installUpdate()
    await settle()
    expect(calls).toEqual(['beginQuit', 'destroyAllWindows', 'quitAndInstall'])

    jest.advanceTimersByTime(15_000)

    expect(calls).toEqual(['beginQuit', 'destroyAllWindows', 'quitAndInstall', 'cancelQuit'])
    expect(showMessageBox).toHaveBeenCalledTimes(1)
    expect(updateState()).toEqual({ status: 'ready', version: '1.1.0' })

    calls.length = 0
    installUpdate()
    await settle()
    expect(calls).toEqual(['beginQuit', 'destroyAllWindows', 'quitAndInstall'])
  })

  it('leaves the install alone once Squirrel has asked the app to quit', () => {
    // The install the previous test started again is still on its timer.
    calls.length = 0
    showMessageBox.mockClear()

    appEvents.emit('before-quit')
    jest.advanceTimersByTime(15_000)
    jest.useRealTimers()

    expect(calls).toEqual([])
    expect(showMessageBox).not.toHaveBeenCalled()
  })
})
