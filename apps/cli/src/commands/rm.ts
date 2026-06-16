import { getPaths } from '@siastorage/node-adapters'
import { ensureDaemonRunning } from '../daemon/supervisor'
import { createDaemonClient } from '../lib/appServiceClient'
import { c } from '../lib/format'
import { normalizePath } from '../lib/normalizePath'
import { resolveFile } from '../lib/resolveFile'

export async function rmCommand(
  dataDir: string,
  target: string,
  opts?: { permanent?: boolean; recursive?: boolean },
) {
  const p = getPaths(dataDir)
  await ensureDaemonRunning(p)
  const app = createDaemonClient(p.sockPath)

  const normalized = normalizePath(target)

  if (opts?.recursive) {
    const dir = await app.directories.getByPath(normalized)
    if (dir) {
      const count = await app.directories.deleteAndTrashFiles(dir.id)
      console.log(`Removed ${c.red(normalized)} (${count} files trashed)`)
      return
    }
  }

  const record = await resolveFile(app, normalized)

  if (!record) {
    const dir = await app.directories.getByPath(normalized)
    if (dir) {
      console.error(`"${normalized}" is a directory, use ${c.bold('rm -r')} to remove`)
    } else {
      console.error(`Not found: ${normalized}`)
    }
    process.exit(1)
  }

  if (opts?.permanent) {
    await app.files.tombstoneFile(record.id)
    console.log(`Permanently deleted ${c.red(record.name)}`)
  } else {
    await app.files.trashFile(record.id)
    console.log(`Trashed ${c.yellow(record.name)}`)
  }
}
