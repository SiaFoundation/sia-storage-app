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

  /** Runs `fn` against a device's screen and closes the session after, whatever happens. */
  const withUi = async <T>(name: string, fn: (ui: UiSurface) => Promise<T>): Promise<T> => {
    const d = openDevice(current(), name)
    if (!d.ui) throw new Error(`${name} is a ${d.kind} device, which has no screen to drive`)
    const ui = d.ui()
    try {
      return await fn(ui)
    } finally {
      await ui.close()
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
    .action(async (name: string) => print(await withUi(name, (ui) => ui.describe())))

  /** The --text, --label, --id and --contains options every element command takes. */
  const selecting = (command: Command): Command =>
    command
      .option('--text <text>', 'Visible text, any case')
      .option('--label <label>', 'accessibilityLabel, exactly')
      .option('--id <id>', 'testID, exactly')
      .option('--contains <text>', 'Part of the text or label, any case')

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
  ).action(async (name: string, opts: Selector) => {
    const sel = selector(opts)
    await withUi(name, (ui) => ui.tap(sel))
    console.log(`tapped ${JSON.stringify(sel)} on ${name}`)
  })

  selecting(
    device
      .command('long-press <name>')
      .description('Press and hold the element on a phone')
      .option('--ms <ms>', 'How long to hold', integer, 1000),
  ).action(async (name: string, opts: Selector & { ms: number }) => {
    const sel = selector(opts)
    await withUi(name, (ui) => {
      if (!ui.longPress) throw new Error(`${name} has no long press`)
      return ui.longPress(sel, opts.ms)
    })
    console.log(`long-pressed ${JSON.stringify(sel)} on ${name}`)
  })

  selecting(
    device
      .command('type <name> <text>')
      .description('Type into the field on a phone or in the desktop app')
      .option('--clear', 'Empty the field first')
      .option('--submit', 'Press return after typing'),
  ).action(
    async (name: string, text: string, opts: Selector & { clear?: boolean; submit?: boolean }) => {
      const sel = selector(opts)
      await withUi(name, (ui) => ui.type(sel, text, { clear: opts.clear, submit: opts.submit }))
      console.log(`typed into ${JSON.stringify(sel)} on ${name}`)
    },
  )

  selecting(
    device.command('clear <name>').description('Empty the field on a phone or in the desktop app'),
  ).action(async (name: string, opts: Selector) => {
    const sel = selector(opts)
    await withUi(name, (ui) => ui.clear(sel))
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
  ).action(async (name: string, opts: Selector & { direction: string }) => {
    const sel = selector(opts)
    const swipe = swipeDirection(opts.direction)
    await withUi(name, (ui) => {
      if (!ui.scrollTo) throw new Error(`${name} has no scrolling`)
      return ui.scrollTo(sel, swipe)
    })
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
  ).action(async (name: string, opts: Selector & { gone?: boolean; timeout: number }) => {
    const sel = selector(opts)
    const start = performance.now()
    await withUi(name, (ui) =>
      opts.gone ? ui.waitForGone(sel, opts.timeout) : ui.waitFor(sel, opts.timeout).then(() => {}),
    )
    const ms = Math.round(performance.now() - start)
    console.log(`${opts.gone ? 'gone' : 'found'} ${JSON.stringify(sel)} on ${name} after ${ms}ms`)
  })
}
