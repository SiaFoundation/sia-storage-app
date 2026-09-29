/** Commands that read how a device is doing: its filtered log, its load, its call timings and its tables. */
import { InvalidArgumentError } from 'commander'
import { openDevice } from '../devices'
import { bench, filterLogs, isLevel, type LogFilter, perf, schema } from '../observe'
import { type CommandContext, integer, parseArg, print } from './shared'

function level(text: string): LogFilter['level'] {
  if (!isLevel(text)) throw new InvalidArgumentError('One of debug, info, warn, error.')
  return text
}

export function registerObserveCommands({ program, current }: CommandContext): void {
  program
    .command('logs <device>')
    .description("Print a device's latest log lines, from the daemon's log or the app's log table")
    .option('-n, --lines <n>', 'Lines', integer, 50)
    .option('--scope <scope>', 'Only lines from this logger scope, e.g. uploader')
    .option('--level <level>', 'Only lines at this level or above', level)
    .option('--grep <text>', 'Only lines containing this text, any case')
    .option('-f, --follow', 'Keep printing new lines until interrupted')
    .action(async (name: string, opts: LogFilter & { lines: number; follow?: boolean }) => {
      const device = openDevice(current(), name)
      const filtered =
        opts.scope !== undefined || opts.level !== undefined || opts.grep !== undefined
      // Filtering and following read far enough back that `-n` lines survive
      // the filter, and that a second's worth of new lines is never cut off.
      const window = filtered || opts.follow ? 5000 : opts.lines
      const read = async () => filterLogs(await device.logs(window), opts)
      let shown = (await read()).slice(-opts.lines)
      if (shown.length > 0) console.log(shown.join('\n'))
      while (opts.follow) {
        await Bun.sleep(1000)
        const lines = await read()
        // The last line printed marks where the new ones start. Lines are
        // timestamped to the millisecond, so a repeat is the same line.
        const last = shown.at(-1)
        const from = last === undefined ? 0 : lines.lastIndexOf(last) + 1
        const fresh = lines.slice(from)
        if (fresh.length > 0) {
          console.log(fresh.join('\n'))
          shown = fresh
        }
      }
    })

  program
    .command('perf <device>')
    .description("Sample a device's app process once a second: CPU percent and resident memory")
    .option('--seconds <n>', 'How many one-second samples', integer, 5)
    .action(async (name: string, opts: { seconds: number }) => {
      print(await perf(openDevice(current(), name), Math.max(1, opts.seconds)))
    })

  program
    .command('bench <device> <method> [args...]')
    .description(
      'Time repeated calls of an AppService method and print the spread, in milliseconds',
    )
    .option('--runs <n>', 'Timed calls', integer, 30)
    .option('--concurrency <n>', 'Calls in flight at once', integer, 1)
    .option('--warmup <n>', 'Untimed calls first', integer, 3)
    .action(
      async (
        name: string,
        method: string,
        args: string[],
        opts: { runs: number; concurrency: number; warmup: number },
      ) => {
        print(await bench(openDevice(current(), name), method, args.map(parseArg), opts))
      },
    )

  program
    .command('schema <device> [table]')
    .description("List a device's tables with their row counts, or one table's columns")
    .action(async (name: string, table: string | undefined) => {
      print(await schema(openDevice(current(), name), table))
    })
}
