/** Steps the sign-in scenarios share: the phrases, and the window's phrase grid. */
import type { DesktopUi } from '../../src/devices/desktop-ui'
import { AppTimeout } from '../../src/wait'

/**
 * The recovery phrase every device on the mock network signs in with: the one
 * its sign-in generates, and the one `sia connect` registers a CLI device under.
 */
export const ACCOUNT_PHRASE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'.split(
    ' ',
  )

/** The heading of the first screen, where the Mac asks to be connected. */
export const WELCOME = 'Private storage, right in Finder'

/** The tour's slides, in order, by their headings. */
export const TOUR = [
  'Encrypted on this Mac',
  'Split into 30 pieces',
  'Sent straight to storage providers',
  'Your files live in Finder',
  'And on your phone',
]

/** Twelve words from the BIP-39 list that no device on the network has registered. */
export const UNUSED_PHRASE =
  'legal winner thank year wave sausage worth useful legal winner thank yellow'.split(' ')

/** Fills the twelve slots of the phrase grid, replacing whatever they hold. */
export async function enterPhrase(ui: DesktopUi, words: string[]): Promise<void> {
  for (const [index, word] of words.entries()) {
    await ui.type({ label: `Word ${index + 1}` }, word, { clear: true })
  }
}

/** The words the phrase grid shows, in order. */
export async function shownPhrase(ui: DesktopUi): Promise<string[]> {
  const words: string[] = []
  for (let slot = 1; slot <= 12; slot++) {
    words.push((await ui.read({ label: `Word ${slot}` })) ?? '')
  }
  return words
}

/** Whether the button with this text is there and can be clicked. */
export async function buttonEnabled(ui: DesktopUi, text: string): Promise<boolean> {
  const button = (await ui.describe()).find((el) => el.role === 'button' && el.text === text)
  return button !== undefined && button.disabled !== true
}

/**
 * Waits for setup to say it is ready. A timeout names what each step showed,
 * because "not ready" alone does not say which step the Mac stopped on.
 */
export async function setupReady(ui: DesktopUi, timeoutMs: number): Promise<void> {
  try {
    await ui.waitFor({ text: 'Sia Storage is ready' }, timeoutMs)
  } catch (e) {
    if (!(e instanceof AppTimeout)) throw e
    const shown: string[] = []
    for (const id of ['account', 'finder', 'metadata', 'folders']) {
      shown.push((await ui.read({ id: `step-${id}` }).catch(() => null)) ?? `no ${id} step`)
    }
    throw new AppTimeout(`${e.message}. Setup showed: ${shown.join(', ')}`)
  }
}
