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

  program
    .command('reset')
    .description('Wipe the local database and re-sync from the indexer')
    .action(async () => {
      const { resetCommand } = await import('./commands/reset')
      await resetCommand(resolveDataDir())
    })

  program
    .command('ls')
    .description('List files and directories')
    .argument('[path...]', 'Directory path')
    .option('-s, --sort <field>', 'Sort by name, size, or date', 'date')
    .option('-t, --type <type>', 'Filter by type: image, video, audio, document')
    .option('--tag <tag>', 'Filter by tag')
    .action(async (pathParts: string[], opts) => {
      const { lsCommand } = await import('./commands/ls')
      const dirPath = pathParts.length > 0 ? pathParts.join('/') : undefined
      await lsCommand(resolveDataDir(), dirPath, opts)
    })

  program
    .command('mkdir')
    .description('Create a directory')
    .argument('<name...>', 'Directory name')
    .action(async (parts: string[]) => {
      const { mkdirCommand } = await import('./commands/mkdir')
      await mkdirCommand(resolveDataDir(), parts.join('/'))
    })

  program
    .command('rm')
    .description('Remove a file or directory')
    .argument('<target...>', 'File name, ID, or directory path')
    .option('-p, --permanent', 'Permanently delete (cannot be undone)')
    .option('-r, --recursive', 'Remove a directory and all its contents')
    .action(async (parts: string[], opts: { permanent?: boolean; recursive?: boolean }) => {
      const { rmCommand } = await import('./commands/rm')
      await rmCommand(resolveDataDir(), parts.join('/'), opts)
    })

  program
    .command('mv')
    .description('Move or rename a file or directory')
    .argument('<source>', 'File name, ID, or directory path')
    .argument('<destination>', 'Destination directory path or new name')
    .action(async (source: string, destination: string) => {
      const { mvCommand } = await import('./commands/mv')
      await mvCommand(resolveDataDir(), source, destination)
    })

  program
    .command('add')
    .description('Add a file')
    .argument('<path>', 'File path')
    .argument('[destination]', 'Target directory (e.g. photos/)')
    .option('-d, --dir <directory>', 'Target directory')
    .action(async (path: string, destination: string | undefined, opts: { dir?: string }) => {
      const { addCommand } = await import('./commands/add')
      await addCommand(resolveDataDir(), path, { dir: opts.dir ?? destination })
    })

  program
    .command('download')
    .description('Download a file')
    .argument('<file...>', 'File name or ID')
    .option('-o, --output <path>', 'Output path')
    .action(async (parts: string[], opts: { output?: string }) => {
      const { downloadCommand } = await import('./commands/download')
      await downloadCommand(resolveDataDir(), parts.join('/'), opts)
    })

  program
    .command('import')
    .description('Recursively import files from a local directory')
    .argument('<path>', 'Local directory path')
    .argument('[remote-dir]', 'Target directory in Sia (default: directory basename)')
    .option('--dry-run', 'Show what would be imported without importing')
    .option('--skip-existing', 'Skip files that already exist (by content hash)')
    .action(
      async (
        importPath: string,
        remoteDir: string | undefined,
        opts: { dryRun?: boolean; skipExisting?: boolean },
      ) => {
        const { importCommand } = await import('./commands/import')
        await importCommand(resolveDataDir(), importPath, remoteDir, opts)
      },
    )

  program
    .command('info')
    .description('Show file details')
    .argument('<file...>', 'File name or ID')
    .action(async (parts: string[]) => {
      const { infoCommand } = await import('./commands/info')
      await infoCommand(resolveDataDir(), parts.join('/'))
    })

  program.parseAsync(process.argv).catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
