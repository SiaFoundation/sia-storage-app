import { defineScenario } from '../../src/scenario'
import { ACCOUNT_PHRASE, enterPhrase, shownPhrase, WELCOME } from './sign-in'

const EMPTY_GRID = ACCOUNT_PHRASE.map(() => '')

export default defineScenario({
  name: 'a recovery phrase typed into sign-in is cleared by Start over and by closing the window',
  description:
    "The laptop is signed in, so after Connect the Mac's window opens on Welcome back and asks for the account's phrase. The phrase is typed and Start over chosen, and connecting again shows Welcome back with an empty grid. The phrase is typed again and the window closed the way its close button closes it, and when the window is opened again the grid is empty.",
  devices: { laptop: 'cli', mac: 'desktop-signed-out' },
  timeoutMs: 5 * 60_000,
  async run({ devices: { mac }, network, step, precondition, checkEqual, waitFor }) {
    const ui = mac.ui().window('main')

    await precondition('the laptop has registered the account', () =>
      waitFor('the account to hold a key', async () => (await network.auth()).appKeys.length > 0, {
        timeoutMs: 60_000,
      }),
    )
    await step('the Mac opens its window on sign-in', () => ui.waitFor({ text: WELCOME }, 60_000))
    await step('ask to connect', () => ui.tap({ text: 'Connect' }))
    await step("the window asks for the account's phrase", () =>
      ui.waitFor({ text: 'Welcome back' }),
    )
    await step("type the account's phrase", () => enterPhrase(ui, ACCOUNT_PHRASE))
    checkEqual('the grid holds the typed phrase', await shownPhrase(ui), ACCOUNT_PHRASE)

    await step('start over', async () => {
      await ui.tap({ text: 'Start over' })
      await ui.waitFor({ text: WELCOME })
    })
    await step('ask to connect again', async () => {
      await ui.tap({ text: 'Connect' })
      await ui.waitFor({ text: 'Welcome back' })
    })
    checkEqual('after Start over the grid is empty', await shownPhrase(ui), EMPTY_GRID)

    await step("type the account's phrase again", () => enterPhrase(ui, ACCOUNT_PHRASE))
    await step('close the window', async () => {
      await mac.ui().closeWindow('main')
      await waitFor('the window to close', async () => !(await mac.ui().isShowing('main')))
    })
    await step('open the window again', () => mac.openWindow())
    await step('it still asks for the phrase', () => ui.waitFor({ text: 'Welcome back' }))
    checkEqual('after closing the window the grid is empty', await shownPhrase(ui), EMPTY_GRID)
  },
})
