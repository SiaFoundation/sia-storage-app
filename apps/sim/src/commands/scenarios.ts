/** `run`, `list` and `prune`: saved scenarios and the sessions their runs leave behind. */
import { Option } from 'commander'
import { PHONE_KINDS, type PhoneKind } from '../devices'
import { otherRunInProgress, prune, reapIdle } from '../prune'
import { FAILING, failureLine } from '../report'
import { findScenarios, runScenarios } from '../run'
import { type CommandContext, integer } from './shared'

export function registerScenarioCommands({ program }: CommandContext): void {
  program
    .command('run [filters...]')
    .description('Run scenarios (all, or those whose path contains a filter) and write a report')
    .option('--keep', 'Keep every session directory, not only failed ones')
    .option('--real-timers', 'Use production sync and upload timers')
    .option('-j, --jobs <n>', 'Scenarios to run at once', integer, 1)
    .option('--keep-devices', 'Leave phones booted and Metro running for the next run')
    .addOption(
      new Option('--phone <platform>', 'Platform for phone devices')
        .choices(PHONE_KINDS)
        .default(PHONE_KINDS[0]),
    )
    .addHelpText(
      'after',
      `
Environment:
  SIM_PROGRESS_FILE  A path the run rewrites as JSON at its start and as each
                     scenario starts and ends, for a reader that cannot see
                     the console until the run exits, such as a CI step:
                     {"total", "done", "passed", "failed", "errored",
                     "knownBug", "fixed", "skipped", "running": [names],
                     "latest": {"verdict", "name", "reason"} or null}`,
    )
    .action(
      async (
        filters: string[],
        {
          keepDevices,
          ...opts
        }: {
          keep?: boolean
          realTimers?: boolean
          jobs: number
          phone?: PhoneKind
          keepDevices?: boolean
        },
      ) => {
        const files = await findScenarios(filters)
        if (files.length === 0) throw new Error(`No scenarios match ${filters.join(' ')}`)
        const { report, paths, cancelled } = await runScenarios(files, {
          ...opts,
          progressFile: process.env.SIM_PROGRESS_FILE || undefined,
          onResult: (r) => {
            const passed = r.checks.filter((c) => c.ok).length
            const review = r.needsReview ? ', needs review' : ''
            const intermittent = r.intermittent ? ', intermittent known bug' : ''
            const crashed = r.startCrashes ? `, ${r.startCrashes.length} start crash` : ''
            console.log(
              `${r.verdict.padEnd(9)} ${r.name} (${passed}/${r.checks.length} checks, ${(r.ms / 1000).toFixed(1)}s${review}${intermittent}${crashed})`,
            )
            const why = failureLine(r)
            if (why) console.log(`          ${why}`)
          },
        })
        const count = (v: string) => report.results.filter((r) => r.verdict === v).length
        const failed = report.results.filter((r) => FAILING.has(r.verdict)).length
        const known = count('KNOWN_BUG')
        const skipped = count('SKIP')
        const review = report.results.filter((r) => r.needsReview).length
        const crashes = report.results.reduce((n, r) => n + (r.startCrashes?.length ?? 0), 0)
        const intermittent = report.results.filter((r) => r.intermittent).length
        console.log(
          `run ${report.runId}: ${count('PASS')} passed, ${failed} failed${known ? `, ${known} known bug` : ''}${skipped ? `, ${skipped} skipped` : ''}${review ? `, ${review} need review` : ''}${crashes ? `, ${crashes} start crashes` : ''}${intermittent ? `, ${intermittent} intermittent` : ''}`,
        )
        console.log(`report ${paths.md}`)
        // Another run in this checkout may lease one of these phones for its
        // next scenario, so they are left for the idle shutdown instead.
        if (!keepDevices && !otherRunInProgress()) {
          const reaped = await reapIdle(0)
          if (reaped.length > 0) console.log(`shut down ${reaped.length} idle phones`)
        }
        process.exitCode = cancelled ? 130 : failed > 0 ? 1 : 0
      },
    )

  program
    .command('list')
    .description('List scenario files')
    .action(async () => {
      for (const file of await findScenarios([])) console.log(file)
    })

  program
    .command('prune')
    .description("Kill processes left by this checkout's crashed runs and remove their sessions")
    .option(
      '--all',
      "Also remove this checkout's named sessions, and release the simulators, emulators and servers its phones use",
    )
    .option(
      '--force',
      'With --all, prune even while a run looks in progress, for CI cleanup after a cancelled job or a developer whose run was killed',
    )
    .action(async (opts: { all?: boolean; force?: boolean }) => {
      if (opts.force && !opts.all) throw new Error('--force only applies with --all')
      const { killed, sessions, released } = await prune(opts)
      console.log(
        `killed ${killed} processes, removed ${sessions.length} sessions, released ${released.length} simulators or emulators`,
      )
    })
}
