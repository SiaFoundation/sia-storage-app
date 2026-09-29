/** `net`: inspect the mock network and change its conditions and faults. */
import { SDK_OPS } from '@siastorage/mock-network/protocol'
import { Argument } from 'commander'
import { networkControl } from '../network'
import { parseSize } from '../seed'
import { type CommandContext, integer, print } from './shared'

export function registerNetCommands({ program, current }: CommandContext): void {
  const net = program.command('net').description('Inspect and change the mock network')
  const control = () => networkControl(current())

  net.command('summary').action(async () => print(await control().summary()))
  net
    .command('objects')
    .option('--unpinned', 'Include uploads not yet pinned')
    .action(async (opts: { unpinned?: boolean }) => print(await control().objects(opts)))
  net.command('events').action(async () => print(await control().events()))
  net
    .command('requests')
    .option('--device <name>')
    .option('--op <op>')
    .action(async (opts: { device?: string; op?: string }) => print(await control().requests(opts)))
  net
    .command('offline <device>')
    .description('Take a device off the network')
    .action(async (name: string) => print(await control().setOffline(name, true)))
  net
    .command('online <device>')
    .action(async (name: string) => print(await control().setOffline(name, false)))
  net
    .command('latency <ms>')
    .description('Delay every SDK call by this many milliseconds')
    .action(async (ms: string) => print(await control().setConditions({ latencyMs: integer(ms) })))
  net
    .command('rate <size>')
    .description('Upload rate per second shared by all devices, e.g. 2m. 0 is unlimited')
    .action(async (size: string) =>
      print(await control().setConditions({ uploadBytesPerSec: parseSize(size) })),
    )
  net
    .command('fail')
    .description('Fail the next matching SDK calls')
    .addArgument(new Argument('<op>', 'The SDK call to fail').choices(SDK_OPS))
    .option('--device <name>')
    .option('-n, --count <n>', 'How many calls to fail', integer, 1)
    .option('--status <code>', 'HTTP status', integer, 500)
    .option('--message <text>', 'Error message', 'injected failure')
    .action(async (op, opts: { device?: string; count: number; status: number; message: string }) =>
      print(await control().addFault({ op, ...opts })),
    )
  net.command('clear-faults').action(async () => {
    await control().clearFaults()
    console.log('faults cleared')
  })
}
