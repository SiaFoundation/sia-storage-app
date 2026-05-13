import { resolve } from 'path'
import { getPaths } from '@siastorage/node-adapters'
import { daemonCommand, ensureDaemonRunning } from '../daemon/supervisor'
import { createDaemonClient } from '../lib/appServiceClient'
import { c } from '../lib/format'
import { resolveFile } from '../lib/resolveFile'

export async function downloadCommand(dataDir: string, file: string, opts?: { output?: string }) {
  const p = getPaths(dataDir)
  await ensureDaemonRunning(p)
  const app = createDaemonClient(p.sockPath)

  const record = await resolveFile(app, file)
  if (!record) {
    console.error(`File not found: ${file}`)
    process.exit(1)
  }

  // The daemon runs from its own cwd, so we must resolve to an absolute path
  // here in the user's shell before sending over IPC.
  const output = resolve(opts?.output ?? record.name)

  try {
    const result = (await daemonCommand(p, 'download', {
      fileId: record.id,
      output,
    })) as { name: string; path: string }
    console.log(`Downloaded ${c.green(result.name)} -> ${c.dim(result.path)}`)
  } catch (e) {
    console.error(`Download failed: ${e instanceof Error ? e.message : String(e)}`)
    process.exit(1)
  }
}
