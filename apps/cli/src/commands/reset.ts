import * as fs from 'fs'
import * as clack from '@clack/prompts'
import {
  ensureDataDir,
  getPaths,
  isDaemonRunning,
  readDaemonPid,
  sendIpcCommand,
} from '@siastorage/node-adapters'
import { ensureDaemonRunning } from '../daemon/supervisor'
import { c } from '../lib/format'

export async function resetCommand(dataDir: string) {
  const p = getPaths(dataDir)

  const confirm = await clack.confirm({
    message:
      'This will wipe the local database and cached files and re-sync from the indexer. Continue?',
    initialValue: false,
  })

  if (clack.isCancel(confirm) || !confirm) {
    console.log(c.dim('Cancelled'))
    return
  }

  // Stop daemon if running
  if (isDaemonRunning(p.pidPath)) {
    try {
      await sendIpcCommand(p.sockPath, 'shutdown', {}, 5000)
    } catch {
      // IPC may close before response
    }
    const pid = readDaemonPid(p.pidPath)
    if (pid) {
      const deadline = Date.now() + 5000
      while (Date.now() < deadline) {
        try {
          process.kill(pid, 0)
          await new Promise((r) => setTimeout(r, 100))
        } catch {
          break
        }
      }
    }
    // A daemon still running, such as one waiting on a slow upload, would go
    // on using the database and the files folder deleted below.
    if (isDaemonRunning(p.pidPath)) {
      console.error(
        c.red(
          `The daemon (PID ${pid}) is still running, so nothing was reset. Stop it with \`sia daemon stop\` and run reset again.`,
        ),
      )
      process.exitCode = 1
      return
    }
    console.log(c.dim('Daemon stopped'))
  }

  // Delete DB and storage (keep secrets.json for credentials)
  for (const file of [
    p.dbPath,
    `${p.dbPath}-shm`,
    `${p.dbPath}-wal`,
    p.storagePath,
    p.statePath,
    p.lockPath,
    p.pidPath,
  ]) {
    try {
      fs.unlinkSync(file)
    } catch {
      // File may not exist
    }
  }

  // The cached copies belong to the library just dropped. Cache eviction finds
  // what to remove through the database, so nothing would ever remove these.
  fs.rmSync(p.filesDir, { recursive: true, force: true })
  ensureDataDir(p.dataDir)

  console.log(c.green('Database reset'))

  // Restart daemon — it will re-sync from the indexer
  await ensureDaemonRunning(p)
  const pid = readDaemonPid(p.pidPath)
  console.log(c.green(`Daemon started (PID: ${pid}), syncing from indexer...`))
}
