import { resolve } from 'path'
import { getPaths } from '@siastorage/node-adapters'
import { daemonCommand } from '../daemon/supervisor'
import { c } from '../lib/format'
import { normalizePath } from '../lib/normalizePath'

export async function addCommand(dataDir: string, filePath: string, opts?: { dir?: string }) {
  const p = getPaths(dataDir)
  const absPath = resolve(filePath)
  const directory = opts?.dir ? normalizePath(opts.dir) : undefined

  try {
    const result = (await daemonCommand(p, 'upload', {
      path: absPath,
      directory,
    })) as { id: string; name: string }

    console.log(`Added ${c.green(result.name)} (${c.dim(result.id)})`)
  } catch (e) {
    console.error(`Add failed: ${e instanceof Error ? e.message : String(e)}`)
    process.exit(1)
  }
}
