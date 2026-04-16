#!/usr/bin/env bun
import { resolve } from 'node:path'
import { Command } from 'commander'
import { isDaemonRunning, readDaemonPid, getDataDir, getPaths } from '@siastorage/node-adapters'
import { c } from './lib/format'

// Hidden entry points for daemon mode and shell completion
if (process.env.SIA_DAEMON_MODE === '1') {
  import('./daemon/entry').then(({ startDaemon }) => startDaemon())
} else if (process.argv[2] === '__complete') {
  import('./commands/completions').then(({ completeCommand }) =>
    completeCommand(process.argv.slice(3)),
  )
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

  program
    .command('status')
    .description('Show sync and storage status')
    .option('--size', 'Show bytes instead of counts')
    .action(async (opts: { size?: boolean }) => {
      const { statusCommand } = await import('./commands/status')
      await statusCommand(resolveDataDir(), opts)
    })

  program
    .command('sync')
    .description('Show sync status')
    .action(async () => {
      const { syncCommand } = await import('./commands/sync')
      await syncCommand(resolveDataDir())
    })

  program
    .command('tags')
    .description('List all tags')
    .action(async () => {
      const { tagsCommand } = await import('./commands/tags')
      await tagsCommand(resolveDataDir())
    })

  program
    .command('tag')
    .description('Add a tag to a file')
    .argument('<file>', 'File name or ID')
    .argument('<tag>', 'Tag name')
    .action(async (file: string, tag: string) => {
      const { tagCommand } = await import('./commands/tags')
      await tagCommand(resolveDataDir(), file, tag)
    })

  program
    .command('untag')
    .description('Remove a tag from a file')
    .argument('<file>', 'File name or ID')
    .argument('<tag>', 'Tag name')
    .action(async (file: string, tag: string) => {
      const { untagCommand } = await import('./commands/tags')
      await untagCommand(resolveDataDir(), file, tag)
    })

  program
    .command('search')
    .description('Search files')
    .argument('<query...>', 'Search query')
    .action(async (parts: string[]) => {
      const query = parts.join(' ')
      const { searchCommand } = await import('./commands/search')
      await searchCommand(resolveDataDir(), query)
    })

  program
    .command('config')
    .description('View or set configuration')
    .argument('[action]', 'Action: set')
    .argument('[key]', 'Config key')
    .argument('[value]', 'Config value')
    .action(async (action?: string, key?: string, value?: string) => {
      const { configCommand } = await import('./commands/config')
      await configCommand(resolveDataDir(), action, key, value)
    })

  program
    .command('logs')
    .description('Show daemon logs')
    .option('-f, --follow', 'Follow log output')
    .option('-n, --lines <count>', 'Number of lines to show', '50')
    .action(async (opts: { follow?: boolean; lines?: string }) => {
      const { logsCommand } = await import('./commands/logs')
      await logsCommand(resolveDataDir(), opts)
    })

  program
    .command('completions')
    .description('Generate shell completion script')
    .argument('[shell]', 'Shell type: zsh or bash')
    .action(async (shell?: string) => {
      const { completionsCommand } = await import('./commands/completions')
      await completionsCommand(resolveDataDir(), shell)
    })

  const serve = program
    .command('serve')
    .description('Start HTTP file server')
    .option('-p, --port <port>', 'Port to listen on', '3000')
    .option('--host <host>', 'Host to bind to', '0.0.0.0')
    .action(async (opts: { port: string; host: string }) => {
      const { serveCommand } = await import('./commands/serve')
      await serveCommand(resolveDataDir(), opts)
    })

  const serveRoutes = serve
    .command('routes')
    .description('Manage serve route access control')
    .action(async () => {
      const { listRoutesCommand } = await import('./commands/serveRoutes')
      await listRoutesCommand(resolveDataDir())
    })

  serveRoutes
    .command('add')
    .description('Add or update a route')
    .argument('<path>', 'Directory path to serve')
    .option('--listing', 'Enable directory listing')
    .option('--no-listing', 'Disable directory listing')
    .option('--download', 'Enable file downloads')
    .option('--no-download', 'Disable file downloads')
    .option('--recursive', 'Apply to all subdirectories')
    .option('--no-recursive', 'Only apply to this directory and its files')
    .action(
      async (
        routePath: string,
        opts: { listing?: boolean; download?: boolean; recursive?: boolean },
      ) => {
        const { addRouteCommand } = await import('./commands/serveRoutes')
        await addRouteCommand(resolveDataDir(), routePath, opts)
      },
    )

  serveRoutes
    .command('rm')
    .description('Remove a route')
    .argument('<path>', 'Route path to remove')
    .action(async (routePath: string) => {
      const { removeRouteCommand } = await import('./commands/serveRoutes')
      await removeRouteCommand(resolveDataDir(), routePath)
    })

  program.parse()
}
