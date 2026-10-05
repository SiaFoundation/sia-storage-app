/** `up`, `down` and `status`: a session's network and devices as a whole. */
import { addDevice, allDevices, DEVICE_KINDS, openDevice } from '../devices'
import { recordCommand, transcript } from '../evidence'
import { startNetwork, stopNetwork } from '../network'
import { checkNewSessionName, type DeviceKind, Session } from '../session'
import { type CommandContext, print } from './shared'

export function registerSessionCommands({ program, sessionName, current }: CommandContext): void {
  const up = program
    .command('up')
    .description('Start the mock network and devices (default: CLI devices phone and laptop)')
    .option('--real-timers', 'Use production sync and upload timers')
    .option(
      '--signed-out <names>',
      'Comma-separated desktop device names that start with no account, to sign in through the window',
      '',
    )
  for (const kind of DEVICE_KINDS) {
    up.option(
      `--${kind} <names>`,
      `Comma-separated ${kind} device names`,
      kind === 'cli' ? 'phone,laptop' : '',
    )
  }
  up.action(async (opts: Record<string, string> & { realTimers?: boolean }) => {
    const signedOut = new Set(opts.signedOut.split(',').filter(Boolean))
    const name = sessionName()
    const existing = Session.load(name)
    const wanted = DEVICE_KINDS.flatMap((kind) =>
      opts[kind]
        .split(',')
        .filter(Boolean)
        .map((device): [string, DeviceKind] => [device, kind]),
    )
    for (const [device, kind] of wanted) {
      const recorded = existing?.state.devices[device]?.kind
      if (recorded && recorded !== kind) {
        throw new Error(
          `Device ${device} in session ${name} was added as ${recorded}, not ${kind}. Name it under --${recorded}, or start over with \`bun sim down --clean\`.`,
        )
      }
    }
    if (existing?.state.fastTimers && opts.realTimers) {
      throw new Error(
        `Session ${name} runs with fast timers. Start it over with \`sim down --clean\` to use real ones.`,
      )
    }
    if (!existing) checkNewSessionName(name)
    const session = existing ?? Session.create(name, { fastTimers: !opts.realTimers })
    // cli.ts records a command before it runs only when its session exists,
    // so the `up` that creates one records itself here.
    if (!existing) recordCommand(session, process.argv.slice(2))
    const before = session.state.networkUrl
    const url = await startNetwork(session)
    console.log(`network ${url}`)
    // A device reads the network's address once, when it starts, so one still
    // running from before a network that came back on another port would keep
    // calling the old one.
    if (before && before !== url) {
      for (const d of allDevices(session)) {
        if (!(await d.isRunning())) continue
        await d.stop()
        await d.start()
        console.log(`device ${d.name} restarted on the new network`)
      }
    }
    await Promise.all(
      wanted.map(async ([device, kind]) => {
        const d = session.state.devices[device]
          ? openDevice(session, device)
          : await addDevice(session, device, kind, { signedOut: signedOut.has(device) })
        if (!(await d.isRunning())) await d.start()
        console.log(`device ${device} (${kind}) running`)
      }),
    )
    const timers = session.state.fastTimers ? 'shortened' : 'production'
    console.log(`session ${session.name} at ${session.dir}, with ${timers} timers`)
  })

  program
    .command('transcript')
    .description(
      'Print every sim command run against the session, in order, as the steps to reproduce what it showed',
    )
    .action(() => {
      for (const line of transcript(current())) console.log(line)
    })

  program
    .command('down')
    .description('Stop every device and the network')
    .option('--clean', 'Also delete the session directory and hand back its simulators')
    .action(async (opts: { clean?: boolean }) => {
      const session = current()
      for (const device of allDevices(session)) {
        await device.stop().catch(() => device.kill().catch(() => {}))
        console.log(`device ${device.name} stopped`)
      }
      await stopNetwork(session)
      console.log('network stopped')
      if (opts.clean) {
        // A phone keeps its simulator leased until then, so `up` resumes it
        // with its data.
        for (const d of allDevices(session)) await d.dispose?.()
        session.remove()
        console.log(`removed ${session.dir}`)
      }
    })

  program
    .command('status')
    .description('Show the session, its network and devices')
    .action(async () => {
      const session = current()
      const devices = await Promise.all(
        allDevices(session).map(async (d) => ({
          name: d.name,
          kind: d.kind,
          running: await d.isRunning(),
          files: (await d.library().catch(() => [])).length,
        })),
      )
      print({
        session: session.name,
        dir: session.dir,
        fastTimers: session.state.fastTimers,
        network: session.state.networkUrl ?? null,
        devices,
      })
    })
}
