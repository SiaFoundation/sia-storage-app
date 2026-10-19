/** `live login` and `live check`: the real-network test account live sessions sign into. */
import { checkLogin, login } from '../live'
import { runTool } from '../process'
import type { CommandContext } from './shared'

export function registerLiveCommands({ program }: CommandContext): void {
  const live = program
    .command('live')
    .description('The real-network test account that `up --live` and `run --live` sign phones into')

  live
    .command('login')
    .description(
      'Approve this app for the test account in a browser once, and store the app key phones connect with',
    )
    .action(async () => {
      await login((url) => {
        console.log(`Approve the connection as the test account, never a personal one:\n${url}`)
        void runTool(['open', url], { timeoutMs: 10_000 }).catch(() => {})
      })
      console.log(
        'Approved. SIM_LIVE_APP_KEY is in .env.sim-live, and live phones sign in with it.',
      )
    })

  live
    .command('check')
    .description('Whether the stored app key still connects to the test account')
    .action(async () => {
      const ok = await checkLogin()
      console.log(ok ? 'The test account accepts the stored app key.' : 'The app key was refused.')
      if (!ok) process.exitCode = 1
    })
}
