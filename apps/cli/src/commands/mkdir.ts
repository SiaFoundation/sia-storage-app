import { getPaths } from '@siastorage/node-adapters'
import { ensureDaemonRunning } from '../daemon/supervisor'
import { createDaemonClient } from '../lib/appServiceClient'
import { c } from '../lib/format'
import { normalizePath } from '../lib/normalizePath'

export async function mkdirCommand(dataDir: string, name: string) {
  const p = getPaths(dataDir)
  await ensureDaemonRunning(p)
  const app = createDaemonClient(p.sockPath)

  const normalized = normalizePath(name)

  try {
    const dir = await app.directories.getOrCreateAtPath(normalized)
    console.log(`Created directory ${c.cyan(dir.path)}`)
  } catch (e) {
    console.error(`Error: ${e instanceof Error ? e.message : String(e)}`)
    process.exit(1)
  }
}
