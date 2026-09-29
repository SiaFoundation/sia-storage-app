/**
 * Drives one phone's UI through its accessibility tree. The session attaches
 * to the running app and never launches, stops or resets it, because sim does
 * those itself and a scenario asserts against the state a previous step left.
 * A kill or relaunch ends the session under it, so a call that finds its
 * session gone opens a new one and tries once more.
 *
 * Opening a session can take the app out of the foreground. On iOS the first
 * session on a simulator installs and launches WebDriverAgent's runner app,
 * which leaves the home screen showing, so `onOpen` runs after every session
 * opens to bring the app back.
 */
import { waitFor, waitForApp } from '../wait'
import { ensureAppium } from './server'
import type { PhoneKind } from '../session'
import { describeTree, findCenter, findTapPoint, locators, type Selector } from './tree'

export type SwipeDirection = 'up' | 'down' | 'left' | 'right'

/** Appium answered a request with an error status. */
class AppiumError extends Error {}

/** Longer than any platform's `appium:*LaunchTimeout` across all its startup attempts. */
const SESSION_START_TIMEOUT_MS = 15 * 60_000

/**
 * Seconds Appium keeps a session no request has touched. A runner killed
 * without closing its session would otherwise leave it open, with its port,
 * until Appium stops.
 */
export const IDLE_SESSION_SECONDS = 3600

export class UiDriver {
  private sessionId: string | null = null
  /** Set by close(), after which the driver refuses to open another session. */
  private closed = false
  /** Sessions opened so far, so a wait can tell it spanned a reopen. */
  private opened = 0

  constructor(
    private readonly platform: PhoneKind,
    private readonly capabilities: Record<string, unknown>,
    private readonly hooks: {
      /** Runs after every session opens. */
      onOpen: () => Promise<void>
      /**
       * Whether the app has been told the keyboard is open. Where given,
       * typing returns only once it has, since a tap the app takes before it
       * hears of the keyboard is handled as if there were none.
       */
      keyboardShown?: () => Promise<boolean>
    },
  ) {}

  private async request(
    method: string,
    path: string,
    body?: unknown,
    timeoutMs = 300_000,
  ): Promise<unknown> {
    const res = await fetch(`${await ensureAppium()}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      // A wedged WebDriverAgent hangs instead of failing.
      signal: AbortSignal.timeout(timeoutMs),
    })
    const text = await res.text()
    if (!res.ok) {
      if (/invalid session|session is either terminated|not started/i.test(text))
        this.sessionId = null
      // UiAutomator2's on-device server can crash mid-session, and every later
      // call on the session then fails one of these ways. The dead session is
      // closed so the retry opens a fresh one.
      if (
        /instrumentation process is not running|could not proxy command to the remote server/i.test(
          text,
        ) &&
        this.sessionId
      ) {
        const dead = this.sessionId
        this.sessionId = null
        await fetch(`${await ensureAppium()}/session/${dead}`, { method: 'DELETE' }).catch(() => {})
      }
      throw new AppiumError(`Appium ${method} ${path}: ${res.status} ${text.slice(0, 1000)}`)
    }
    return (JSON.parse(text) as { value: unknown }).value
  }

  private async session(): Promise<string> {
    if (this.closed) throw new Error('This UI driver is closed')
    if (this.sessionId) return this.sessionId
    // Longer than the platform's own launch timeout, which on iOS covers
    // building WebDriverAgent, so Appium gives up before this does and no
    // session is left open behind an abandoned request.
    let value: { sessionId: string }
    for (let attempt = 1; ; attempt++) {
      try {
        value = (await this.request(
          'POST',
          '/session',
          { capabilities: { alwaysMatch: this.capabilities, firstMatch: [{}] } },
          SESSION_START_TIMEOUT_MS,
        )) as { sessionId: string }
        break
      } catch (e) {
        // Appium answered with an error, as it does when one of its own adb
        // or simctl commands fails on a busy device, so no session opened and
        // trying again leaves none behind. A timeout is not retried.
        if (attempt === 3 || !(e instanceof AppiumError)) throw e
        await Bun.sleep(2000)
      }
    }
    this.sessionId = value.sessionId
    this.opened++
    await this.hooks.onOpen()
    return value.sessionId
  }

  /**
   * Runs `fn` against the session, reopening it once if a session that was
   * open has gone away. A session that failed to open is not retried, since
   * Appium may still be starting it.
   */
  private async withSession<T>(fn: (id: string) => Promise<T>): Promise<T> {
    const wasOpen = this.sessionId !== null
    try {
      return await fn(await this.session())
    } catch (e) {
      if (!wasOpen || this.sessionId !== null) throw e
      return fn(await this.session())
    }
  }

  /** The accessibility tree as XML. */
  source(): Promise<string> {
    return this.withSession(
      async (id) => (await this.request('GET', `/session/${id}/source`)) as string,
    )
  }

  /** The visible elements a selector can name, for writing one. */
  async describe(): Promise<ReturnType<typeof describeTree>> {
    return describeTree(await this.source(), this.platform)
  }

  async isVisible(sel: Selector): Promise<boolean> {
    return findCenter(await this.source(), sel, this.platform) !== null
  }

  /**
   * Waits for a visible element matching `sel` and returns its center. The
   * session opens first, so a slow reopen is not counted against the app.
   */
  async waitFor(sel: Selector, timeoutMs = 15_000): Promise<[number, number]> {
    await this.session()
    return this.overReopen(() =>
      waitForApp(
        `an element matching ${JSON.stringify(sel)}`,
        async () => findCenter(await this.source(), sel, this.platform),
        { timeoutMs, intervalMs: 500 },
      ),
    )
  }

  /**
   * Runs a wait once more when a session reopened while it ran. Opening a
   * UiAutomator2 session after its on-device server crashed takes most of a
   * 15s wait, which would otherwise fail on time the app never had.
   */
  private async overReopen<T>(wait: () => Promise<T>): Promise<T> {
    const before = this.opened
    try {
      return await wait()
    } catch (e) {
      if (this.opened === before) throw e
      return wait()
    }
  }

  /**
   * Taps where the element can take it. The center of a full-screen backdrop
   * such as a dropdown's "Close menu" lies under the menu it closes. On iOS
   * the element is clicked, and XCUITest picks a point where it is hittable.
   * UiAutomator2 clicks an element's center, so on Android the tap presses
   * the point findTapPoint picks, which moves off the center only for a
   * full-screen backdrop.
   */
  async tap(sel: Selector, timeoutMs?: number): Promise<void> {
    if (this.platform === 'android') {
      await this.session()
      const [x, y] = await this.overReopen(() =>
        waitForApp(
          `an element matching ${JSON.stringify(sel)}`,
          async () => findTapPoint(await this.source(), sel, this.platform),
          { timeoutMs: timeoutMs ?? 15_000, intervalMs: 500 },
        ),
      )
      await this.press(x, y, 50)
      return
    }
    const elementId = await this.element(sel, timeoutMs, true)
    await this.withSession((id) =>
      this.request('POST', `/session/${id}/element/${elementId}/click`, {}),
    )
  }

  /** Presses and releases at a point: a tap for a short `holdMs`, a long press for a long one. */
  private press(x: number, y: number, holdMs: number): Promise<unknown> {
    return this.withSession((id) =>
      this.request('POST', `/session/${id}/actions`, {
        actions: [
          {
            type: 'pointer',
            id: 'finger',
            parameters: { pointerType: 'touch' },
            actions: [
              { type: 'pointerMove', duration: 0, x, y },
              { type: 'pointerDown', button: 0 },
              { type: 'pause', duration: holdMs },
              { type: 'pointerUp', button: 0 },
            ],
          },
        ],
      }),
    )
  }

  async longPress(sel: Selector, holdMs = 1000): Promise<void> {
    const [x, y] = await this.waitFor(sel)
    await this.press(x, y, holdMs)
  }

  /**
   * Finds the element matching `sel` through the platform's own query and
   * returns its WebDriver id. Keys go to an element rather than a point, so
   * typing needs this where a tap needs only the center from the tree.
   */
  private async element(sel: Selector, timeoutMs = 15_000, tappable = false): Promise<string> {
    await this.waitFor(sel, timeoutMs)
    const find = async (onlyTappable: boolean) => {
      for (const query of locators(sel, this.platform, onlyTappable)) {
        const found = (await this.withSession((id) =>
          this.request('POST', `/session/${id}/elements`, query),
        )) as Array<Record<string, string>>
        if (found.length > 0) return found
      }
      return []
    }
    // While a screen is being pushed the tree can show an element before the
    // platform's query finds it, so the query is retried rather than tried once.
    return waitForApp(
      `the platform to find an element matching ${JSON.stringify(sel)}`,
      async () => {
        // A section header and the row under it can share their text, and the
        // platform's query returns the header first. findCenter prefers the row too.
        let found = tappable ? await find(true) : []
        if (found.length === 0) found = await find(false)
        return found[0] ? Object.values(found[0])[0] : undefined
      },
      { timeoutMs, intervalMs: 250 },
    )
  }

  /** Types into the field matching `sel`, after clearing it when `clear` is set. */
  async type(
    sel: Selector,
    text: string,
    opts: { clear?: boolean; submit?: boolean } = {},
  ): Promise<void> {
    const elementId = await this.element(sel)
    // XCUITest taps the field before typing, which opens the keyboard as a
    // person's tap does. UiAutomator2 sets the text without focusing the
    // field, so the keyboard never opens unless the field is clicked first.
    if (this.platform === 'android') {
      await this.withSession((id) =>
        this.request('POST', `/session/${id}/element/${elementId}/click`, {}),
      )
    }
    // XCUITest clears with delete keystrokes, and on a CI simulator those
    // close the iOS keyboard, which neither the typing that follows nor a tap
    // on the field brings back. A scenario that needs the keyboard up types
    // over a field that selects its text on focus instead of clearing it.
    if (opts.clear) {
      await this.withSession((id) =>
        this.request('POST', `/session/${id}/element/${elementId}/clear`, {}),
      )
    }
    // XCUITest sends a newline as the return key. UiAutomator2 types it into
    // the field as a space, and a hardware Enter reaches a field inside a
    // modal sheet only sometimes, so Android sends the keyboard's done action,
    // as a person's tap on the done key does.
    const newline = opts.submit && this.platform === 'ios'
    await this.withSession((id) =>
      this.request('POST', `/session/${id}/element/${elementId}/value`, {
        text: newline ? `${text}\n` : text,
      }),
    )
    const { keyboardShown } = this.hooks
    // A keyboard that never opens leaves the next tap untested, which is a
    // failure of setup rather than of the app, so this is not an app wait.
    if (!opts.submit && keyboardShown) {
      await waitFor(
        'the app to hear the keyboard open',
        async () => (await keyboardShown()) || undefined,
        { timeoutMs: 5000, intervalMs: 250 },
      )
      // The keyboard opening resizes the screen, and a tap read before the
      // layout stops moving lands where a button used to be.
      await this.settled()
    }
    if (opts.submit && !newline) {
      await this.withSession((id) =>
        this.request('POST', `/session/${id}/execute/sync`, {
          script: 'mobile: performEditorAction',
          args: [{ action: 'done' }],
        }),
      )
    }
  }

  async clear(sel: Selector): Promise<void> {
    const elementId = await this.element(sel)
    await this.withSession((id) =>
      this.request('POST', `/session/${id}/element/${elementId}/clear`, {}),
    )
  }

  /** The screen's size in the units the tree's coordinates use. */
  private async screen(): Promise<{ width: number; height: number }> {
    return (await this.withSession((id) => this.request('GET', `/session/${id}/window/rect`))) as {
      width: number
      height: number
    }
  }

  /**
   * Drags a finger from the element matching `sel`, or from the middle of the
   * screen, a third of the screen in `direction`. `up` moves the finger upward,
   * which scrolls a list toward its end, as a person's swipe does. Starting on
   * the element is what closes a bottom sheet: dragging down on one of its rows
   * pans the sheet, where a drag that starts on the backdrop does nothing.
   */
  async swipe(direction: SwipeDirection, sel?: Selector): Promise<void> {
    const { width, height } = await this.screen()
    const [x0, y0] = sel ? await this.waitFor(sel) : [width / 2, height / 2]
    const dx = { left: -1, right: 1, up: 0, down: 0 }[direction] * width * 0.33
    const dy = { up: -1, down: 1, left: 0, right: 0 }[direction] * height * 0.33
    const clamp = (v: number, max: number) => Math.round(Math.min(max - 5, Math.max(5, v)))
    await this.withSession((id) =>
      this.request('POST', `/session/${id}/actions`, {
        actions: [
          {
            type: 'pointer',
            id: 'finger',
            parameters: { pointerType: 'touch' },
            actions: [
              { type: 'pointerMove', duration: 0, x: clamp(x0, width), y: clamp(y0, height) },
              { type: 'pointerDown', button: 0 },
              { type: 'pause', duration: 100 },
              {
                type: 'pointerMove',
                duration: 400,
                x: clamp(x0 + dx, width),
                y: clamp(y0 + dy, height),
              },
              { type: 'pointerUp', button: 0 },
            ],
          },
        ],
      }),
    )
  }

  /**
   * Swipes `direction` until an element matching `sel` is visible. Gives up
   * once a swipe leaves the screen unchanged, which is the end of the list. A
   * swipe moves a third of the screen, so 100 cover a list of several hundred
   * rows.
   */
  async scrollTo(sel: Selector, direction: SwipeDirection = 'up'): Promise<void> {
    let before = await this.source()
    for (let i = 0; i < 100; i++) {
      if (findCenter(before, sel, this.platform)) return
      await this.swipe(direction)
      const after = await this.settled()
      if (after === before) break
      before = after
    }
    if (findCenter(await this.source(), sel, this.platform)) return
    throw new Error(`Scrolled ${direction} to the end without finding ${JSON.stringify(sel)}`)
  }

  /**
   * The tree once two reads 300ms apart match, up to 5 seconds. A swipe on
   * Android flings the list on after the finger lifts, so an element found
   * before it stops has moved by the time a tap reaches it, and the tap hits
   * whatever scrolled under that point instead.
   */
  private async settled(): Promise<string> {
    let last = await this.source()
    for (let i = 0; i < 16; i++) {
      await Bun.sleep(300)
      const next = await this.source()
      if (next === last) return next
      last = next
    }
    return last
  }

  /** The system back: Android's back key, or the navigation bar's back button on iOS. */
  async back(): Promise<void> {
    await this.withSession((id) => this.request('POST', `/session/${id}/back`, {}))
    // A back press has no element to wait for, and Android drops a second
    // press that lands while the first one's screen transition is running.
    await this.settled()
  }

  async hideKeyboard(): Promise<void> {
    await this.withSession((id) =>
      this.request('POST', `/session/${id}/execute/sync`, {
        script: 'mobile: hideKeyboard',
        args: [{}],
      }),
    ).catch(() => {})
  }

  /** Waits until no visible element matches `sel`, such as a sheet that is closing. */
  async waitForGone(sel: Selector, timeoutMs = 15_000): Promise<void> {
    await this.session()
    await this.overReopen(() =>
      waitForApp(
        `no element matching ${JSON.stringify(sel)}`,
        async () => findCenter(await this.source(), sel, this.platform) === null,
        { timeoutMs, intervalMs: 500 },
      ),
    )
  }

  get isClosed(): boolean {
    return this.closed
  }

  async close(): Promise<void> {
    this.closed = true
    if (!this.sessionId) return
    await this.request('DELETE', `/session/${this.sessionId}`).catch(() => {})
    this.sessionId = null
  }
}

const LOGGED_ACTIONS: ReadonlySet<string> = new Set([
  'waitFor',
  'waitForGone',
  'tap',
  'longPress',
  'type',
  'clear',
  'swipe',
  'scrollTo',
  'back',
  'hideKeyboard',
])

/**
 * Returns `driver` with each action a scenario calls written to `write` as a
 * line with its arguments, how long it took and how it ended. A step's time
 * in a report covers all of its actions, and this shows which one took it.
 * Calls an action makes to another go through the driver itself, so only the
 * scenario's own calls are written.
 */
export function logActions(driver: UiDriver, write: (line: string) => void): UiDriver {
  return new Proxy(driver, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      if (typeof prop !== 'string' || !LOGGED_ACTIONS.has(prop) || typeof value !== 'function') {
        return typeof value === 'function' ? value.bind(target) : value
      }
      return async (...args: unknown[]) => {
        const started = Date.now()
        const what = `${prop} ${args.map((a) => JSON.stringify(a)).join(' ')}`
        const stamp = new Date(started).toISOString().slice(11, 23)
        try {
          const out = await value.apply(target, args)
          write(`${stamp} ${what} ${Date.now() - started}ms\n`)
          return out
        } catch (e) {
          const why = e instanceof Error ? e.message.split('\n')[0].slice(0, 200) : String(e)
          write(`${stamp} ${what} failed after ${Date.now() - started}ms: ${why}\n`)
          throw e
        }
      }
    },
  })
}
