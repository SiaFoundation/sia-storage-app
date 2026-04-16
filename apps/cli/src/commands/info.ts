import { getPaths } from '@siastorage/node-adapters'
import { ensureDaemonRunning } from '../daemon/supervisor'
import { createDaemonClient } from '../lib/appServiceClient'
import { c, formatBytes, formatDate } from '../lib/format'
import { resolveFile } from '../lib/resolveFile'

export async function infoCommand(dataDir: string, file: string) {
  const p = getPaths(dataDir)
  await ensureDaemonRunning(p)
  const app = createDaemonClient(p.sockPath)

  const record = await resolveFile(app, file)

  if (!record) {
    console.error(`File not found: ${file}`)
    process.exit(1)
  }

  console.log(`${c.bold('Name')}:      ${record.name}`)
  console.log(`${c.bold('ID')}:        ${record.id}`)
  console.log(`${c.bold('Type')}:      ${record.type}`)
  console.log(`${c.bold('Size')}:      ${formatBytes(record.size as number)}`)
  console.log(`${c.bold('Hash')}:      ${record.hash}`)
  console.log(`${c.bold('Created')}:   ${formatDate(record.createdAt as number)}`)
  console.log(`${c.bold('Updated')}:   ${formatDate(record.updatedAt as number)}`)

  const dirPath = await app.directories.getPathForFile(record.id)
  if (dirPath) {
    console.log(`${c.bold('Directory')}: ${dirPath}`)
  }

  const tags = await app.tags.getForFile(record.id)
  if (tags.length > 0) {
    console.log(`${c.bold('Tags')}:      ${tags.map((t: any) => t.name).join(', ')}`)
  }
}
