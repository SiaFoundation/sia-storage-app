#!/usr/bin/env bun
/**
 * `sim`: runs real app processes against a shared mock network, for agents and
 * people verifying behavior across devices, and runs the saved scenarios.
 *
 * Commands that return records, such as `status`, `library`, `sql` and
 * `net summary`, print JSON on stdout, so an agent can parse
 * them. Commands that return text, such as `logs`, `transcript`, `list` and
 * `device finder`, print it as plain lines. Everything else prints one short
 * line per action.
 */
import { Command } from 'commander'
import { registerDeviceCommands } from './commands/device'
import { registerNetCommands } from './commands/net'
import { registerObserveCommands } from './commands/observe'
import { registerPhoneCommands } from './commands/phone'
import { registerScenarioCommands } from './commands/scenarios'
import { registerSessionCommands } from './commands/session'
import { createContext } from './commands/shared'
import { recordCommand } from './evidence'
import { reapIdle } from './prune'
import { Session } from './session'

const program = new Command('sim')
  .description('Run real Sia Storage app processes against a shared mock network')
  .option('-s, --session <name>', 'Session name (default: this checkout, or SIM_SESSION)')

// Every command first shuts down this checkout's phones that have sat unused
// in the pool, since a pooled phone otherwise stays booted until something
// drains the pool, holding its memory for as long as the machine runs.
program.hook('preAction', async () => {
  await reapIdle().catch((e: unknown) => {
    console.error(`Could not shut down idle phones: ${e instanceof Error ? e.message : String(e)}`)
  })
  // Recorded before the command runs, so one that fails still shows in the
  // transcript as the step it was. The `up` that creates a session records
  // itself once the session exists.
  const session = Session.load(ctx.sessionName())
  const args = process.argv.slice(2)
  if (session && args[0] !== 'transcript') recordCommand(session, args)
})

const ctx = createContext(program)
registerSessionCommands(ctx)
registerDeviceCommands(ctx)
registerObserveCommands(ctx)
registerPhoneCommands(ctx)
registerNetCommands(ctx)
registerScenarioCommands(ctx)

// Exits when the command finishes rather than when the event loop drains, so
// a handle left open by a server or device it started cannot keep a finished
// run alive after its report is written.
program.parseAsync().then(
  () => process.exit(process.exitCode ?? 0),
  (e) => {
    console.error(e instanceof Error ? e.message : String(e))
    process.exit(1)
  },
)
