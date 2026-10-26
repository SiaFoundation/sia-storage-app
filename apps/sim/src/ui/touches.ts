/**
 * Taps that the app acknowledges. Appium can report a tap as sent when it
 * never reached the app, as on a loaded CI phone where a tap lands while the
 * screen is still drawing, and the scenario then fails a step later on a
 * screen that never opened. In test mode the app counts the touches its root
 * views see, so sim reads the count before a tap and waits for it to rise.
 *
 * A tap the app never received is sent again, which cannot do anything twice
 * because the first did nothing. A tap the app received is never sent again,
 * even when the screen then shows nothing new. That is a failure of the app
 * or of the scenario, and the next wait reports it.
 */
import { AppTimeout } from '../wait'

/** What became of a tap. */
export type TapOutcome =
  /** The app's touch count rose after it. */
  | 'received'
  /** The count never rose and the element went from the screen anyway. */
  | 'gone'
  /** The count could not be read, so nothing is known. */
  | 'unknown'

const TAP_ATTEMPTS = 3

/**
 * Sends a tap with `send` until the app's count from `count` rises, up to
 * TAP_ATTEMPTS taps. `stillThere` says whether the element is still on screen.
 * An element that went while the count stayed put was taken by something other
 * than the app's views, such as a system dialog over the app, so it gets no
 * further tap. `count` returns null when the app cannot answer, as when the
 * tap sent it to the background.
 */
export async function tapUntilReceived(opts: {
  what: string
  send: () => Promise<void>
  count: () => Promise<number | null>
  stillThere: () => Promise<boolean>
  /** Called before each tap after the first, to say one was lost. */
  onLost?: (attempt: number) => void
  windowMs?: number
}): Promise<TapOutcome> {
  for (let attempt = 1; ; attempt++) {
    const before = await opts.count()
    if (before === null) {
      await opts.send()
      return 'unknown'
    }
    await opts.send()
    const after = await waitForRise(opts.count, before, opts.windowMs ?? 1_000)
    if (after === null) return 'unknown'
    if (after > before) return 'received'
    if (!(await opts.stillThere())) return 'gone'
    if (attempt === TAP_ATTEMPTS) {
      throw new AppTimeout(`The app received none of ${TAP_ATTEMPTS} taps on ${opts.what}`)
    }
    opts.onLost?.(attempt)
  }
}

/**
 * The count once it passes `before`, or the last count read once `windowMs`
 * has passed and at least two reads have answered after the tap. The app
 * counts touches and answers reads on its JavaScript thread, so while that
 * thread is busy, such as mounting a long list, each read waits for it, and a
 * clock-only window would close before a queued touch was counted. Null when
 * a read fails.
 */
async function waitForRise(
  count: () => Promise<number | null>,
  before: number,
  windowMs: number,
): Promise<number | null> {
  const deadline = Date.now() + windowMs
  for (let reads = 1; ; reads++) {
    const now = await count()
    if (now === null || now > before) return now
    if (reads >= 2 && Date.now() >= deadline) return now
    await Bun.sleep(100)
  }
}
