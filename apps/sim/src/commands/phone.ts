/**
 * Commands on a device's screen, for phones and the desktop app, and the ones
 * only phones have: backgrounding and the locks an iOS app holds.
 */
import type { Command } from 'commander'
import { IosDevice, openDevice, PhoneDevice } from '../devices'
import type { UiSurface } from '../devices/types'
import type { SwipeDirection } from '../ui/driver'
import type { Selector } from '../ui/tree'
import { type CommandContext, integer, print } from './shared'

function swipeDirection(text: string): SwipeDirection {
  if (!['up', 'down', 'left', 'right'].includes(text)) {
    throw new Error(`Swipe up, down, left or right, not ${text}`)
  }
  return text as SwipeDirection
}

export function registerPhoneCommands({ program, current }: CommandContext): void {
  const device = program.commands.find((c) => c.name() === 'device')
  if (!device) throw new Error('Register the device commands before the phone commands')

  const phone = (name: string): PhoneDevice => {
    const d = openDevice(current(), name)
    if (!(d instanceof PhoneDevice)) throw new Error(`${name} is a ${d.kind} device, not a phone`)
    return d
  }

  /**
   * Runs `fn` against a device's screen and closes the session after, whatever
   * happens. `window` limits it to one of the desktop app's windows.
   */
  const withUi = async <T>(
    name: string,
    fn: (ui: UiSurface) => Promise<T>,
    window?: string,
  ): Promise<T> => {
    const d = openDevice(current(), name)
    if (!d.ui) throw new Error(`${name} is a ${d.kind} device, which has no screen to drive`)
    const whole = d.ui()
    if (window && !whole.window) {
      throw new Error(`${name} is a ${d.kind} device, which has one screen and no --window`)
    }
    const ui = window && whole.window ? whole.window(window) : whole
    try {
      return await fn(ui)
    } finally {
      await whole.close()
    }
  }

  device
    .command('background <name>')
    .description('Send the app to the background, where the OS may suspend it')
    .action(async (name: string) => {
      await phone(name).background()
      console.log(`device ${name} sent to the background`)
    })

  device
    .command('foreground <name>')
    .description('Bring the app back and wait until it answers')
    .action(async (name: string) => {
      await phone(name).foreground()
      console.log(`device ${name} back in the foreground`)
    })

  device.command('screenshot <name> <path>').action(async (name: string, path: string) => {
    await phone(name).screenshot(path)
    console.log(path)
  })

  device
    .command('locks <name>')
    .description('SQLite locks an iOS app holds on its database, read from the Mac')
    .action(async (name: string) => {
      const d = phone(name)
      if (!(d instanceof IosDevice)) throw new Error(`${name} is not an iOS device`)
      print(await d.locks())
    })

  device
    .command('ui <name>')
    .description(
      "List a device's visible elements by text, label and test id, for writing selectors",
    )
    .option('--window <window>', "One of the desktop app's windows: main or popover")
    .action(async (name: string, opts: { window?: string }) =>
      print(await withUi(name, (ui) => ui.describe(), opts.window)),
    )

  /** The --text, --label, --id and --contains options every element command takes. */
  const selecting = (command: Command): Command =>
    command
      .option('--text <text>', 'Visible text, any case')
      .option('--label <label>', 'accessibilityLabel, exactly')
      .option('--id <id>', 'testID, exactly')
      .option('--contains <text>', 'Part of the text or label, any case')
      .option('--window <window>', "One of the desktop app's windows: main or popover")

  const selector = (opts: Selector): Selector => {
    const sel: Selector = {}
    for (const key of ['text', 'label', 'id', 'contains'] as const) {
      if (opts[key] !== undefined) sel[key] = opts[key]
    }
    if (Object.keys(sel).length === 0)
      throw new Error('Name an element with --text, --label, --id or --contains')
    return sel
  }

  selecting(
    device
      .command('tap <name>')
      .description('Tap the element on a phone, or click it in the desktop app'),
  ).action(async (name: string, opts: Selector & { window?: string }) => {
    const sel = selector(opts)
    await withUi(name, (ui) => ui.tap(sel), opts.window)
    console.log(`tapped ${JSON.stringify(sel)} on ${name}`)
  })

  selecting(
    device
      .command('read <name>')
      .description("Print the element's text, such as a status line or a row's value"),
  ).action(async (name: string, opts: Selector & { window?: string }) => {
    const sel = selector(opts)
    const text = await withUi(
      name,
      (ui) => {
        if (!ui.read) throw new Error(`${name} has no element text to read`)
        return ui.read(sel)
      },
      opts.window,
    )
    if (text === null) throw new Error(`No element matching ${JSON.stringify(sel)} on ${name}`)
    console.log(text)
  })

  selecting(
    device
      .command('long-press <name>')
      .description('Press and hold the element on a phone')
      .option('--ms <ms>', 'How long to hold', integer, 1000),
  ).action(async (name: string, opts: Selector & { ms: number; window?: string }) => {
    const sel = selector(opts)
    await withUi(
      name,
      (ui) => {
        if (!ui.longPress) throw new Error(`${name} has no long press`)
        return ui.longPress(sel, opts.ms)
      },
      opts.window,
    )
    console.log(`long-pressed ${JSON.stringify(sel)} on ${name}`)
  })

  selecting(
    device
      .command('type <name> <text>')
      .description('Type into the field on a phone or in the desktop app')
      .option('--clear', 'Empty the field first')
      .option('--submit', 'Press return after typing'),
  ).action(
    async (
      name: string,
      text: string,
      opts: Selector & { clear?: boolean; submit?: boolean; window?: string },
    ) => {
      const sel = selector(opts)
      await withUi(
        name,
        (ui) => ui.type(sel, text, { clear: opts.clear, submit: opts.submit }),
        opts.window,
      )
      console.log(`typed into ${JSON.stringify(sel)} on ${name}`)
    },
  )

  selecting(
    device.command('clear <name>').description('Empty the field on a phone or in the desktop app'),
  ).action(async (name: string, opts: Selector & { window?: string }) => {
    const sel = selector(opts)
    await withUi(name, (ui) => ui.clear(sel), opts.window)
    console.log(`cleared ${JSON.stringify(sel)} on ${name}`)
  })

  device
    .command('swipe <name> <direction>')
    .description(
      'Swipe up, down, left or right on a phone, across the whole screen or --text/--label/--id',
    )
    .option('--text <text>')
    .option('--label <label>')
    .option('--id <id>')
    .action(async (name: string, direction: string, opts: Selector) => {
      const swipe = swipeDirection(direction)
      const named = Object.keys(opts).length > 0 ? selector(opts) : undefined
      await withUi(name, (ui) => {
        if (!ui.swipe) throw new Error(`${name} has no swipe`)
        return ui.swipe(swipe, named)
      })
      console.log(`swiped ${direction} on ${name}`)
    })

  selecting(
    device
      .command('scroll-to <name>')
      .description('Swipe until the element is on screen')
      .option('--direction <direction>', 'The swipe that scrolls toward it', 'up'),
  ).action(async (name: string, opts: Selector & { direction: string; window?: string }) => {
    const sel = selector(opts)
    const swipe = swipeDirection(opts.direction)
    await withUi(
      name,
      (ui) => {
        if (!ui.scrollTo) throw new Error(`${name} has no scrolling`)
        return ui.scrollTo(sel, swipe)
      },
      opts.window,
    )
    console.log(`scrolled to ${JSON.stringify(sel)} on ${name}`)
  })

  device
    .command('back <name>')
    .description("Go back: Android's back key, or the navigation bar's back button on iOS")
    .action(async (name: string) => {
      await withUi(name, (ui) => {
        if (!ui.back) throw new Error(`${name} has no back`)
        return ui.back()
      })
      console.log(`went back on ${name}`)
    })

  device
    .command('hide-keyboard <name>')
    .description("Dismiss a phone's on-screen keyboard")
    .action(async (name: string) => {
      await withUi(name, (ui) => {
        if (!ui.hideKeyboard) throw new Error(`${name} has no on-screen keyboard`)
        return ui.hideKeyboard()
      })
      console.log(`hid the keyboard on ${name}`)
    })

  selecting(
    device
      .command('expect <name>')
      .description('Wait until the element is on screen, or with --gone until it is not')
      .option('--gone', 'Wait for it to disappear')
      .option('--timeout <ms>', 'How long to wait', integer, 15_000),
  ).action(
    async (name: string, opts: Selector & { gone?: boolean; timeout: number; window?: string }) => {
      const sel = selector(opts)
      const start = performance.now()
      await withUi(
        name,
        (ui) =>
          opts.gone
            ? ui.waitForGone(sel, opts.timeout)
            : ui.waitFor(sel, opts.timeout).then(() => {}),
        opts.window,
      )
      const ms = Math.round(performance.now() - start)
      console.log(`${opts.gone ? 'gone' : 'found'} ${JSON.stringify(sel)} on ${name} after ${ms}ms`)
    },
  )
}
