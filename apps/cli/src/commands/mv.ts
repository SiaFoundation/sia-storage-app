import { getPaths } from '@siastorage/node-adapters'
import { ensureDaemonRunning } from '../daemon/supervisor'
import { createDaemonClient } from '../lib/appServiceClient'
import { c } from '../lib/format'
import { normalizePath } from '../lib/normalizePath'
import { resolveFile } from '../lib/resolveFile'

export async function mvCommand(dataDir: string, source: string, destination: string) {
  const p = getPaths(dataDir)
  await ensureDaemonRunning(p)
  const app = createDaemonClient(p.sockPath)

  const src = normalizePath(source)
  const dst = normalizePath(destination)

  // Try source as a directory
  const sourceDir = await app.directories.getByPath(src)
  if (sourceDir) {
    const destParts = dst.split('/')
    const destName = destParts.pop()!
    const destParent = destParts.length > 0 ? destParts.join('/') : null

    const sourceName = src.split('/').pop()!
    if (destName !== sourceName) {
      await app.directories.rename(sourceDir.id, destName)
    }

    const sourceParent = src.includes('/') ? src.split('/').slice(0, -1).join('/') : null
    if (destParent !== sourceParent) {
      await app.directories.moveDirectory(sourceDir.id, destParent)
    }

    console.log(`Moved ${c.cyan(src)} → ${c.cyan(dst)}`)
    return
  }

  // Try source as a file
  const record = await resolveFile(app, src)

  if (!record) {
    console.error(`Not found: ${src}`)
    process.exit(1)
  }

  const destDir = await app.directories.getByPath(dst)
  if (destDir) {
    await app.directories.moveFile(record.id, destDir.id)
    console.log(`Moved ${c.green(record.name)} → ${c.cyan(dst)}`)
  } else {
    await app.files.renameFile(record.id, dst)
    console.log(`Renamed ${c.green(record.name)} → ${c.green(dst)}`)
  }
}
