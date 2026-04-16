#!/usr/bin/env bun
import { resolve } from 'node:path'
import { Command } from 'commander'
import { isDaemonRunning, readDaemonPid, getDataDir, getPaths } from '@siastorage/node-adapters'
import { c } from './lib/format'

// Hidden entry point for daemon mode
if (process.env.SIA_DAEMON_MODE === '1') {
  import('./daemon/entry')
    .then(({ startDaemon }) => startDaemon())
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
} else {
  const program = new Command()
    .name('sia')
    .description('Sia decentralized storage CLI')
    .version('0.0.1')
    .option('-d, --data-dir <path>', 'Data directory (overrides SIA_DATA_DIR)')

  function resolveDataDir(): string {
    const opts = program.opts<{ dataDir?: string }>()
    if (opts.dataDir) return resolve(opts.dataDir)
    return getDataDir()
  }

  program.action(async () => {
    const p = getPaths(resolveDataDir())
    const running = isDaemonRunning(p.pidPath)
    const pid = readDaemonPid(p.pidPath)

    console.log(c.sia('Sia Storage CLI'))
    console.log()
    console.log(`  Daemon: ${running ? c.green(`running (PID: ${pid})`) : c.dim('stopped')}`)
    console.log()
    console.log('Run "sia --help" for available commands')
  })

  program
    .command('connect')
    .description('Connect to a Sia indexer')
    .action(async () => {
      const { connectCommand } = await import('./commands/connect')
      await connectCommand(resolveDataDir())
    })

  program
    .command('daemon')
    .description('Manage the background daemon')
    .argument('[action]', 'start, stop, restart, or status', 'status')
    .option('-f, --foreground', 'Run in foreground')
    .action(async (action: string, opts: { foreground?: boolean }) => {
      const { daemonCommand } = await import('./commands/daemon')
      await daemonCommand(resolveDataDir(), action, opts)
    })

  program.parseAsync(process.argv).catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
