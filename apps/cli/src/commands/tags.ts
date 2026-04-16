import { getPaths } from '@siastorage/node-adapters'
import { ensureDaemonRunning } from '../daemon/supervisor'
import { createDaemonClient } from '../lib/appServiceClient'
import { c, table } from '../lib/format'
import { resolveFile } from '../lib/resolveFile'

export async function tagsCommand(dataDir: string) {
  const p = getPaths(dataDir)
  await ensureDaemonRunning(p)
  const app = createDaemonClient(p.sockPath)

  const tags = await app.tags.getAll()
  if (tags.length === 0) {
    console.log(c.dim('No tags'))
    return
  }
  console.log(
    table(
      ['TAG', 'FILES'],
      tags.map((t: any) => [t.name, String(t.fileCount ?? 0)]),
    ),
  )
}

export async function tagCommand(dataDir: string, file: string, tag: string) {
  const p = getPaths(dataDir)
  await ensureDaemonRunning(p)
  const app = createDaemonClient(p.sockPath)

  const record = await resolveFile(app, file)
  if (!record) {
    console.error(`File not found: ${file}`)
    process.exit(1)
  }
  await app.tags.add(record.id, tag)
  console.log(`Tagged ${c.cyan(record.name)} with ${c.green(tag)}`)
}

export async function untagCommand(dataDir: string, file: string, tag: string) {
  const p = getPaths(dataDir)
  await ensureDaemonRunning(p)
  const app = createDaemonClient(p.sockPath)

  const record = await resolveFile(app, file)
  if (!record) {
    console.error(`File not found: ${file}`)
    process.exit(1)
  }
  const existingTags = await app.tags.getForFile(record.id)
  const tagRecord = existingTags.find((t: any) => t.name === tag)
  if (!tagRecord) {
    console.error(`Tag "${tag}" not found on file`)
    process.exit(1)
  }
  await app.tags.remove(record.id, tagRecord.id)
  console.log(`Removed tag ${c.red(tag)} from ${c.cyan(record.name)}`)
}
