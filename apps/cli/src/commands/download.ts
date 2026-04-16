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

  try {
    await daemonCommand(p, 'download', {
      fileId: record.id,
      output: opts?.output,
    })
    console.log(`Downloaded ${c.green(record.name)}`)
  } catch (e) {
    console.error(`Download failed: ${e instanceof Error ? e.message : String(e)}`)
    process.exit(1)
  }
}
