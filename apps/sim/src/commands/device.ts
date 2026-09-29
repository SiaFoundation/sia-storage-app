/** Commands on one device: its lifecycle, calls into the app, its database and library, and adding files. */
import { Option } from 'commander'
import { waitForConvergence } from '../converge'
import {
  addDevice,
  allDevices,
  CliDevice,
  DesktopDevice,
  DEVICE_KINDS,
  openDevice,
} from '../devices'
import { capture } from '../evidence'
import { addTyped, NAME_STYLES, type NameStyle, seedTypedFiles } from '../filetypes'
import { parseSize, seedFiles } from '../seed'
import type { DeviceKind } from '../session'
import { type CommandContext, integer, parseArg, print } from './shared'

export function registerDeviceCommands({ program, current }: CommandContext): void {
  const device = program.command('device').description('Add, start, stop or kill one device')

  device
    .command('add <name>')
    .addOption(new Option('--kind <kind>', 'Device kind').choices(DEVICE_KINDS).default('cli'))
    .action(async (name: string, opts: { kind: DeviceKind }) => {
      const d = await addDevice(current(), name, opts.kind)
      await d.start()
      console.log(`device ${name} (${opts.kind}) running`)
    })

  device
    .command('capture <name> <label>')
    .description(
      "Save what a device shows now under the session's evidence/<label>: its library, log, a phone's screen, the desktop app's windows and Finder folder",
    )
    .action(async (name: string, label: string) => {
      const session = current()
      console.log(await capture(session, name, openDevice(session, name), label))
    })

  device
    .command('show <name>')
    .description('Put a device on screen for a person to watch')
    .action(async (name: string) => {
      const d = openDevice(current(), name)
      if (!d.show) throw new Error(`${name} is a ${d.kind} device, which has nothing to show`)
      console.log(await d.show())
    })

  const desktop = (name: string): DesktopDevice => {
    const d = openDevice(current(), name)
    if (!(d instanceof DesktopDevice)) throw new Error(`${name} is not a desktop device`)
    return d
  }

  device
    .command('tray <name>')
    .description(
      "Click the desktop app's menu bar icon, which opens its status popover when signed in",
    )
    .action((name: string) => {
      desktop(name).ui().clickTray()
      console.log(`clicked ${name}'s menu bar icon`)
    })

  device
    .command('finder-state <name> <file>')
    .description(
      'What Finder shows for a file in the Finder folder: downloaded or not, hidden extension, type',
    )
    .action((name: string, file: string) => print(desktop(name).finderState(file)))

  device
    .command('download <name> <file>')
    .description('Download a cloud-only file in the Finder folder by reading it through Finder')
    .action(async (name: string, file: string) => {
      await desktop(name).download(file)
      console.log(`downloaded ${file}`)
    })

  device
    .command('finder <name>')
    .description("Print a desktop device's Finder folder, for file operations a person would make")
    .action((name: string) => {
      console.log(desktop(name).finderPath())
    })

  const done = { start: 'running', stop: 'stopped', kill: 'killed' } as const
  for (const action of ['start', 'stop', 'kill'] as const) {
    device.command(`${action} <name>`).action(async (name: string) => {
      await openDevice(current(), name)[action]()
      console.log(`device ${name} ${done[action]}`)
    })
  }

  program
    .command('call <device> <method> [args...]')
    .description('Call an AppService method, e.g. `sim call phone files.getRowsByIds \'["id"]\'`')
    .action(async (name: string, method: string, args: string[]) => {
      print(await openDevice(current(), name).call(method, ...args.map(parseArg)))
    })

  program
    .command('sql <device> <query>')
    .description("Run a read-only query against a device's database")
    .action(async (name: string, query: string) => {
      print(await openDevice(current(), name).sql(query))
    })

  program
    .command('library <device>')
    .description("Print a device's library as sim compares it")
    .action(async (name: string) => {
      print(await openDevice(current(), name).library())
    })

  program
    .command('sia <device> [args...]')
    .description('Run a `sia` CLI command as a CLI device, e.g. `sim sia phone -- mv a.txt docs/`')
    .allowUnknownOption()
    .action(async (name: string, args: string[]) => {
      const d = openDevice(current(), name)
      if (!(d instanceof CliDevice)) throw new Error(`${name} is not a CLI device`)
      const result = await d.cli(...args)
      process.stdout.write(result.stdout)
      process.stderr.write(result.stderr)
      process.exitCode = result.exitCode
    })

  program
    .command('add <device> <paths...>')
    .description("Add local files through the device's own add path")
    .option('--dir <dir>', 'Target directory')
    .action(async (name: string, paths: string[], opts: { dir?: string }) => {
      const d = openDevice(current(), name)
      const added = []
      for (const path of paths) added.push(await d.addFile(path, { dir: opts.dir }))
      print(added)
    })

  program
    .command('seed <device>')
    .description('Generate unique files and add them to a device')
    .option('-n, --count <n>', 'Number of files', integer, 10)
    .option('--size <size>', 'Bytes per file, e.g. 512, 64k, 5m', '64k')
    .option('--dir <dir>', 'Target directory')
    .option('--prefix <prefix>', 'File name prefix')
    .option(
      '--type <types>',
      'Real files of these types, comma-separated: all, a category (image, video, audio, text, document, archive, installer), a MIME type or an extension. -n is then the count per type',
    )
    .addOption(
      new Option('--names <style>', 'How typed files are named')
        .choices(['mixed', ...NAME_STYLES])
        .default('mixed'),
    )
    .action(
      async (
        name: string,
        opts: {
          count: number
          size: string
          dir?: string
          prefix?: string
          type?: string
          names: NameStyle | 'mixed'
        },
      ) => {
        const session = current()
        const d = openDevice(session, name)
        const prefix = opts.prefix ?? `${name}-${Date.now().toString(36)}`
        if (opts.type) {
          const files = await seedTypedFiles(`${session.dir}/seed/${prefix}`, {
            types: opts.type.split(','),
            count: opts.count,
            names: opts.names,
            prefix,
          })
          await addTyped(d, files, { dir: opts.dir })
          console.log(`added ${files.length} files to ${name}`)
          print(files.map((f) => ({ name: f.name, style: f.style, expected: f.expected })))
          return
        }
        const paths = seedFiles(`${session.dir}/seed/${prefix}`, {
          count: opts.count,
          size: parseSize(opts.size),
          prefix,
        })
        for (const path of paths) await d.addFile(path, { dir: opts.dir })
        console.log(`added ${paths.length} files to ${name}`)
      },
    )

  program
    .command('converge [devices...]')
    .description('Wait until devices agree and have nothing left to upload')
    .option('--timeout <ms>', 'Timeout', integer, 60_000)
    .action(async (names: string[], opts: { timeout: number }) => {
      const session = current()
      const devices =
        names.length > 0 ? names.map((n) => openDevice(session, n)) : allDevices(session)
      print(await waitForConvergence(devices, { timeoutMs: opts.timeout }))
    })
}
