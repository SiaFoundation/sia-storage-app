/**
 * Drives the desktop app's own UI: its two Chromium windows through the
 * Chrome DevTools Protocol, and the parts macOS draws, the menu bar icon, its
 * menus and the app's dialogs, through System Events.
 *
 * Both windows load one page and tell themselves apart by the URL hash, `#main`
 * for the window that holds sign-in and `#popover` for the status panel under
 * the menu bar icon. The popover exists only once the icon has been clicked
 * while signed in, and hides whenever it loses focus, so a click or a keystroke
 * here runs as a script inside the page, which moves no focus, rather than as
 * a synthetic mouse event aimed at the screen.
 *
 * Elements are found by the selector phones use: `text` is what the element
 * shows, `label` its aria-label, `id` its data-testid or id, and `contains`
 * part of the text or label.
 *
 * Both windows show the same status, so the same text and test ids appear in
 * each. `window('main')` and `window('popover')` limit every call to one of
 * them. Unscoped, a call acts on the first window with a match. A window that
 * is hidden keeps its page, so `isShowing` is what says one is on screen.
 *
 * System Events needs the terminal running sim switched on under Privacy &
 * Security, Accessibility, and every native action here says so when it is off.
 */
import { writeFileSync } from 'node:fs'
import { waitForApp } from '../wait'
import type { Selector } from '../ui/tree'

export type DesktopElement = {
  window: string
  role: string
  text?: string
  label?: string
  id?: string
  disabled?: boolean
}

type Target = { id: string; type: string; url: string; webSocketDebuggerUrl: string }

/**
 * Runs in the page. Returns the visible elements a selector can name, and when
 * given one, clicks, focuses or fills the first element it matches. Kept as a
 * source string because it runs in the app's renderer, not in sim.
 */
const PAGE_SCRIPT = String.raw`
((sel, action, text) => {
  const shown = (el) => {
    const r = el.getBoundingClientRect()
    const s = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
  }
  const interactive = 'button,a[href],input,select,textarea,[role=button],[role=combobox],[role=option],[role=tab],[role=checkbox],[role=link]'
  const labelOf = (el) => el.getAttribute('aria-label') || (el.labels && el.labels[0] ? el.labels[0].innerText.trim() : '')
  const textOf = (el) => (el.matches('input,textarea,select') ? el.value : el.innerText || '').trim()
  const idOf = (el) => el.getAttribute('data-testid') || el.id || ''
  const leaf = (el) => [...el.children].every((c) => !c.innerText || !c.innerText.trim())
  const all = [...document.querySelectorAll('body *')].filter(shown)
  const named = all.filter((el) => el.matches(interactive) || (leaf(el) && textOf(el)))
  if (!sel) {
    return named.map((el) => ({
      role: el.getAttribute('role') || el.tagName.toLowerCase(),
      text: textOf(el) || undefined,
      label: labelOf(el) || undefined,
      id: idOf(el) || undefined,
      disabled: el.disabled || el.getAttribute('aria-disabled') === 'true' || undefined,
    }))
  }
  const low = (s) => (s || '').toLowerCase()
  const hit = (el) =>
    sel.id !== undefined ? idOf(el) === sel.id
    : sel.label !== undefined ? labelOf(el) === sel.label
    : sel.text !== undefined ? low(textOf(el)) === low(sel.text) || low(labelOf(el)) === low(sel.text)
    : low(textOf(el)).includes(low(sel.contains)) || low(labelOf(el)).includes(low(sel.contains))
  const matched = named.filter(hit)
  const el = matched.find((e) => e.matches(interactive)) || matched[0]
  if (!el) return null
  const target = el.closest(interactive) || el
  if (action === 'read') return textOf(el)
  if (action === 'tap') target.click()
  if (action === 'type' || action === 'clear') {
    target.focus()
    const proto = target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const set = Object.getOwnPropertyDescriptor(proto, 'value').set
    set.call(target, action === 'clear' ? '' : (sel.clearFirst ? '' : target.value) + text)
    target.dispatchEvent(new Event('input', { bubbles: true }))
    target.dispatchEvent(new Event('change', { bubbles: true }))
  }
  if (action === 'submit') {
    target.focus()
    if (target.form) target.form.requestSubmit()
    else target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  }
  return true
})`

export class DesktopUi {
  constructor(
    private readonly debugPort: number,
    /** The app's name as System Events knows its process. */
    private readonly processName: string,
    /** When set, the one window every call is limited to. */
    private readonly only?: string,
  ) {}

  /** The same driver limited to one window, `main` or `popover`. */
  window(name: string): DesktopUi {
    return new DesktopUi(this.debugPort, this.processName, name)
  }

  /**
   * The app's windows, named by their URL hash: `main` and `popover`, each
   * present once it has been opened for the first time.
   */
  private async windows(): Promise<Array<{ name: string; target: Target }>> {
    const res = await fetch(`http://127.0.0.1:${this.debugPort}/json/list`, {
      signal: AbortSignal.timeout(15_000),
    })
    const targets = (await res.json()) as Target[]
    return targets
      .filter((t) => t.type === 'page')
      .map((t) => ({ name: new URL(t.url).hash.slice(1) || 'main', target: t }))
      .filter((w) => !this.only || w.name === this.only)
  }

  /**
   * Whether a window is on screen. Closing the main window and the popover
   * losing focus both hide the window and keep its page, so a page being
   * there says nothing. The app is asked, because the page's own visibility
   * also reads hidden while another window covers it, as the windows of
   * whoever is at the Mac during a run do.
   */
  async isShowing(window: string): Promise<boolean> {
    const found = (await this.window(window).windows())[0]
    if (!found) return false
    const result = await this.send<{ result: { value: boolean } }>(
      found.target,
      'Runtime.evaluate',
      { expression: 'window.sia.windowVisible()', returnByValue: true, awaitPromise: true },
    )
    return result.result.value
  }

  /**
   * Closes a window the way its close button does. Both end in the window's
   * close event, which hides the window and tells its page it was closed.
   */
  async closeWindow(window: string): Promise<void> {
    const found = (await this.window(window).windows())[0]
    if (!found) throw new Error(`No ${window} window to close`)
    await this.send(found.target, 'Runtime.evaluate', {
      expression: 'window.sia.closeWindow()',
      awaitPromise: true,
    })
  }

  /** The text of the first element matching `sel`, or null when no window has one. */
  async read(sel: Selector): Promise<string | null> {
    for (const { target } of await this.windows()) {
      const text = await this.run<string | null>(target, sel, 'read')
      if (text !== null) return text
    }
    return null
  }

  /** Sends one DevTools command to a window and returns its result. */
  private send<T>(target: Target, method: string, params: object): Promise<T> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(target.webSocketDebuggerUrl)
      const timer = setTimeout(() => {
        ws.close()
        reject(new Error(`${method} got no answer from the ${target.url} window`))
      }, 15_000)
      ws.onopen = () => ws.send(JSON.stringify({ id: 1, method, params }))
      ws.onerror = () => {
        clearTimeout(timer)
        reject(new Error(`Could not reach the desktop app's debugging port ${this.debugPort}`))
      }
      ws.onmessage = (event) => {
        const reply = JSON.parse(String(event.data)) as {
          id?: number
          result?: T
          error?: { message: string }
        }
        if (reply.id !== 1) return
        clearTimeout(timer)
        ws.close()
        if (reply.error) reject(new Error(`${method}: ${reply.error.message}`))
        else resolve(reply.result as T)
      }
    })
  }

  private async run<T>(target: Target, sel: unknown, action: string, text = ''): Promise<T> {
    const expression = `${PAGE_SCRIPT}(${JSON.stringify(sel)}, ${JSON.stringify(action)}, ${JSON.stringify(text)})`
    const result = await this.send<{ result: { value: T }; exceptionDetails?: { text: string } }>(
      target,
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true },
    )
    if (result.exceptionDetails)
      throw new Error(`In the desktop app's page: ${result.exceptionDetails.text}`)
    return result.result.value
  }

  /** Every element a selector can name, in every window, and the items of any open native menu or dialog. */
  async describe(): Promise<DesktopElement[]> {
    const out: DesktopElement[] = []
    for (const { name, target } of await this.windows()) {
      for (const el of await this.run<Omit<DesktopElement, 'window'>[]>(target, null, 'list')) {
        out.push({ window: name, ...el })
      }
    }
    for (const item of native(this.processName, 'list') as Array<{ role: string; text: string }>) {
      out.push({ window: 'native', role: item.role, text: item.text })
    }
    return out
  }

  /** Acts on the first window with an element matching `sel`, and returns whether one did. */
  private async act(
    sel: Selector & { clearFirst?: boolean },
    action: string,
    text = '',
  ): Promise<boolean> {
    for (const { target } of await this.windows()) {
      if (await this.run<boolean | null>(target, sel, action, text)) return true
    }
    return false
  }

  async waitFor(sel: Selector, timeoutMs = 15_000): Promise<void> {
    await waitForApp(
      `an element matching ${JSON.stringify(sel)} in the desktop app`,
      async () => (await this.act(sel, 'find')) || nativeHas(this.processName, sel),
      { timeoutMs, intervalMs: 500 },
    )
  }

  async waitForGone(sel: Selector, timeoutMs = 15_000): Promise<void> {
    await waitForApp(
      `no element matching ${JSON.stringify(sel)} in the desktop app`,
      async () => !(await this.act(sel, 'find')) && !nativeHas(this.processName, sel),
      { timeoutMs, intervalMs: 500 },
    )
  }

  /** Clicks the element in a window, or the native menu item or dialog button with that text. */
  async tap(sel: Selector, timeoutMs = 15_000): Promise<void> {
    await this.waitFor(sel, timeoutMs)
    if (await this.act(sel, 'tap')) return
    native(this.processName, 'click', sel.text ?? sel.label ?? sel.contains ?? '')
  }

  async type(
    sel: Selector,
    text: string,
    opts: { clear?: boolean; submit?: boolean } = {},
  ): Promise<void> {
    await this.waitFor(sel)
    await this.must({ ...sel, clearFirst: opts.clear }, 'type', text)
    if (opts.submit) await this.must(sel, 'submit')
  }

  async clear(sel: Selector): Promise<void> {
    await this.waitFor(sel)
    await this.must(sel, 'clear')
  }

  /**
   * Acts on the element and throws when none took it. `waitFor` also accepts
   * a native button, which no page script can type into, and a field matched
   * by its text no longer matches once typing changes that text.
   */
  private async must(sel: Selector & { clearFirst?: boolean }, action: string, text = '') {
    if (!(await this.act(sel, action, text))) {
      throw new Error(`No element in the app's windows took ${action} for ${JSON.stringify(sel)}`)
    }
  }

  /** Clicks the app's menu bar icon, which opens the status popover when signed in. */
  clickTray(): void {
    native(this.processName, 'tray')
  }

  /** Saves a picture of one window's page, `main` or `popover`, and nothing else on screen. */
  async capture(window: string, path: string): Promise<void> {
    const found = (await this.windows()).find((w) => w.name === window)
    if (!found) throw new Error(`The desktop app has no ${window} window open`)
    // The popover's window is transparent behind white text, which a PNG
    // shows as white on white, so the page gets a dark backdrop for
    // the capture and its own background back after.
    const paint = (css: string) =>
      this.send(found.target, 'Runtime.evaluate', {
        expression: `(() => { const prev = document.documentElement.style.background; document.documentElement.style.background = ${JSON.stringify(css)}; return prev })()`,
        returnByValue: true,
      }) as Promise<{ result: { value: string } }>
    const previous = (await paint('#1c1c1e')).result.value
    try {
      const shot = await this.send<{ data: string }>(found.target, 'Page.captureScreenshot', {
        format: 'png',
      })
      writeFileSync(path, Buffer.from(shot.data, 'base64'))
    } finally {
      await paint(previous)
    }
  }

  /** The names of the windows the app has open. */
  async windowNames(): Promise<string[]> {
    return (await this.windows()).map((w) => w.name)
  }

  async close(): Promise<void> {}
}

/**
 * JavaScript for Automation run by `osascript`, over System Events. It lists,
 * finds and clicks the menu items and buttons of the app's menus and dialogs,
 * and clicks its menu bar icon, which is the first item of its second menu bar.
 */
const NATIVE_SCRIPT = String.raw`
function run(argv) {
  const [name, action, text] = argv
  const proc = Application('System Events').processes.byName(name)
  if (action === 'tray') {
    proc.menuBars[1].menuBarItems[0].click()
    return 'ok'
  }
  const found = []
  const visit = (el, depth) => {
    if (depth > 6) return
    let role = ''
    try { role = el.role() } catch (e) { return }
    if (role === 'AXMenuItem' || role === 'AXButton') {
      let title = ''
      try { title = el.title() || el.name() || '' } catch (e) {}
      if (title) found.push({ role: role === 'AXButton' ? 'button' : 'menuitem', text: title, el })
    }
    let kids = []
    try { kids = el.uiElements() } catch (e) {}
    for (const k of kids) visit(k, depth + 1)
  }
  for (const w of proc.windows()) visit(w, 0)
  try { for (const m of proc.menuBars[1].menuBarItems[0].menus()) visit(m, 0) } catch (e) {}
  if (action === 'list') return JSON.stringify(found.map(({ role, text }) => ({ role, text })))
  const hit = found.find((f) => f.text === text) || found.find((f) => f.text.toLowerCase() === (text || '').toLowerCase())
  if (action === 'has') return hit ? 'yes' : 'no'
  if (!hit) throw new Error('No menu item or button titled ' + text)
  hit.el.click()
  return 'ok'
}`

function native(
  processName: string,
  action: 'list' | 'click' | 'tray' | 'has',
  text = '',
): unknown {
  const out = Bun.spawnSync(
    ['osascript', '-l', 'JavaScript', '-e', NATIVE_SCRIPT, processName, action, text],
    { timeout: 30_000 },
  )
  const err = out.stderr.toString()
  if (out.exitCode !== 0) {
    if (/assistive access|not allowed|-1719|-25211/i.test(err)) {
      throw new Error(
        'System Events cannot reach the desktop app. Switch on the terminal running sim under Privacy & Security, Accessibility, in System Settings.',
      )
    }
    // No window or menu is open, which a listing reads as nothing to list.
    if (action === 'list') return []
    if (action === 'has') return false
    throw new Error(`System Events ${action} failed: ${err.trim().slice(0, 300)}`)
  }
  const value = out.stdout.toString().trim()
  if (action === 'list') return JSON.parse(value || '[]')
  if (action === 'has') return value === 'yes'
  return value
}

function nativeHas(processName: string, sel: Selector): boolean {
  const text = sel.text ?? sel.label ?? sel.contains
  return text ? (native(processName, 'has', text) as boolean) : false
}
