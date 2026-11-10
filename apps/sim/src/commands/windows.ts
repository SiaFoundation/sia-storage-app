/** `windows`: builds and looks after the Windows VM that `--windows` devices run in. */
import { existsSync, rmSync } from 'node:fs'
import { PRL_TOOLS_ISO, provision, unattendIso, waitForInstall } from '../windows/image'
import { forgetHostKeys, VM_NAME, WindowsHost } from '../windows/host'
import { ParallelsVm, parallelsInstalled, prlctl } from '../windows/vm'
import { type CommandContext, integer, print } from './shared'

function prl(...args: string[]): void {
  prlctl(args, 600_000)
}

function parallelsVm(): ParallelsVm {
  if (!parallelsInstalled()) {
    throw new Error('prlctl is not installed. It comes with Parallels Desktop Pro.')
  }
  return new ParallelsVm(VM_NAME)
}

export function registerWindowsCommands({ program }: CommandContext): void {
  const windows = program
    .command('windows')
    .description(`Build and look after the Windows VM (${VM_NAME}) that --windows devices run in`)

  windows
    .command('create <iso>')
    .description(
      "Create the VM from Microsoft's Windows 11 ARM64 ISO, install it unattended, set it up and snapshot it as golden",
    )
    .option('--cpus <n>', 'Virtual CPUs', integer, 6)
    .option('--memory <gb>', 'Memory in GB', integer, 8)
    .action(async (iso: string, opts: { cpus: number; memory: number }) => {
      const vm = parallelsVm()
      if (!existsSync(iso)) throw new Error(`No ISO at ${iso}`)
      if ((await vm.state()) !== 'missing') {
        throw new Error(
          `A VM named ${VM_NAME} already exists. Delete it in Parallels, or set SIM_WINDOWS_VM.`,
        )
      }
      const started = Date.now()
      prl('create', VM_NAME, '--distribution', 'win-11')
      prl('set', VM_NAME, '--cpus', String(opts.cpus), '--memsize', String(opts.memory * 1024))
      prl('set', VM_NAME, '--device-set', 'cdrom0', '--image', iso, '--connect')
      const answers = unattendIso()
      prl('set', VM_NAME, '--device-add', 'cdrom', '--image', answers.iso, '--connect')
      prl('set', VM_NAME, '--device-add', 'cdrom', '--image', PRL_TOOLS_ISO, '--connect')
      // The Dev Drive's disk. Windows needs 50 GB for one.
      prl('set', VM_NAME, '--device-add', 'hdd', '--size', String(100 * 1024))
      prl('set', VM_NAME, '--device-bootorder', 'cdrom0 hdd0')
      vm.isolate()
      await vm.start()
      // UEFI boots the CD only after a key press, so keys go in for its first
      // half minute.
      for (let i = 0; i < 15; i++) {
        try {
          prlctl(['send-key-event', VM_NAME, '--scancode', '57'])
        } catch {
          // The VM may not take keys yet in its first seconds.
        }
        await Bun.sleep(2000)
      }
      console.log('installing Windows')
      await waitForInstall(vm)
      // With the install CDs attached and first in the boot order, a key
      // pressed at a later boot would run Setup again, which wipes the disk.
      // The answer file also holds both accounts' passwords, readable from
      // its CD by the test account.
      for (const cd of ['cdrom0', 'cdrom1', 'cdrom2'])
        prl('set', VM_NAME, '--device-set', cd, '--disconnect')
      prl('set', VM_NAME, '--device-bootorder', 'hdd0')
      rmSync(answers.dir, { recursive: true, force: true })
      // A VM built again under this name has new host keys.
      forgetHostKeys()
      console.log(`installed in ${Math.round((Date.now() - started) / 60_000)} minutes, setting up`)
      await provision(vm)
      await vm.snapshot('golden')
      console.log(
        `${VM_NAME} ready in ${Math.round((Date.now() - started) / 60_000)} minutes, snapshot golden taken`,
      )
    })

  windows
    .command('provision')
    .description('Run the image setup again on the existing VM, which every step allows')
    .action(async () => {
      const vm = parallelsVm()
      vm.isolate()
      await vm.start()
      await provision(vm)
    })

  windows
    .command('snapshot <name>')
    .description('Snapshot the VM')
    .action(async (name: string) => {
      await parallelsVm().snapshot(name)
      console.log(`snapshot ${name} taken`)
    })

  windows
    .command('revert [name]')
    .description('Revert the VM to a snapshot, golden unless named')
    .action(async (name = 'golden') => {
      await parallelsVm().revert(name)
      console.log(`${VM_NAME} reverted to ${name}`)
    })

  windows
    .command('status')
    .description("The VM's state, its address, and whether SSH and the agent answer")
    .action(async () => {
      const vm = parallelsVm()
      const state = await vm.state()
      const host = new WindowsHost(vm)
      const address = state === 'running' ? await vm.guestAddress() : null
      const ssh = address ? (await host.ps('exit 0', 15_000)).exitCode === 0 : false
      const agent = address
        ? await host
            .attach()
            .then(() => host.agent<{ user: string; version: string }>('/health', {}, 3_000))
            .catch(() => null)
        : null
      print({ vm: VM_NAME, state, address, ssh, agent })
    })
}
