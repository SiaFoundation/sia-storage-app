import { getPaths } from '@siastorage/node-adapters'
import { ensureDaemonRunning } from '../daemon/supervisor'
import { createDaemonClient } from '../lib/appServiceClient'
import { c, formatBytes, formatRelativeDate, table } from '../lib/format'

export async function searchCommand(dataDir: string, query: string) {
  const p = getPaths(dataDir)
  await ensureDaemonRunning(p)
  const app = createDaemonClient(p.sockPath)

  const allFiles = await app.files.query({
    limit: 1000,
    order: 'DESC',
  })
  const lowerQuery = query.toLowerCase()
  const files = allFiles.filter((f: any) => f.name.toLowerCase().includes(lowerQuery)).slice(0, 50)

  if (files.length === 0) {
    console.log(c.dim('No results'))
    return
  }

  console.log(
    table(
      ['NAME', 'TYPE', 'SIZE', 'MODIFIED'],
      files.map((f: any) => [
        f.name,
        f.type.split('/')[1] ?? f.type,
        formatBytes(f.size),
        formatRelativeDate(f.updatedAt),
      ]),
    ),
  )
}
