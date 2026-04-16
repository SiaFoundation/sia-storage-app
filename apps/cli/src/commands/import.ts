import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import { getPaths } from '@siastorage/node-adapters'
import { daemonCommand, ensureDaemonRunning } from '../daemon/supervisor'
import { createDaemonClient } from '../lib/appServiceClient'
import { c, formatBytes } from '../lib/format'
import { normalizePath } from '../lib/normalizePath'

type ImportOpts = {
  dryRun?: boolean
  skipExisting?: boolean
}

export async function importCommand(
  dataDir: string,
  localPath: string,
  remoteDir: string | undefined,
  opts: ImportOpts,
) {
  const absPath = path.resolve(localPath)

  const stat = fs.statSync(absPath, { throwIfNoEntry: false })
  if (!stat) {
    console.error(`Path not found: ${absPath}`)
    process.exit(1)
  }
  if (!stat.isDirectory()) {
    console.error(`Not a directory: ${absPath}`)
    console.error('Use "sia add" for single files.')
    process.exit(1)
  }

  const baseName = remoteDir ? normalizePath(remoteDir) : path.basename(absPath)
  const files = walkDirectory(absPath)

  if (files.length === 0) {
    console.log('No files found.')
    return
  }

  const totalSize = files.reduce((sum, f) => sum + f.size, 0)

  if (opts.dryRun) {
    console.log(
      `Would import ${files.length} files (${formatBytes(totalSize)}) into ${baseName}/\n`,
    )
    for (const f of files) {
      const remotePath = path.join(baseName, f.relativePath)
      console.log(`  ${remotePath}  ${c.dim(`(${formatBytes(f.size)})`)}`)
    }
    return
  }

  const p = getPaths(dataDir)
  await ensureDaemonRunning(p)
  const app = createDaemonClient(p.sockPath)

  let imported = 0
  let skipped = 0
  let importedBytes = 0

  console.log(`Importing from ${absPath} -> ${baseName}/\n`)

  for (const file of files) {
    const relDir = path.dirname(file.relativePath)
    const directory = relDir === '.' ? baseName : path.join(baseName, relDir)
    const displayPath = path.join(baseName, file.relativePath)

    if (opts.skipExisting) {
      const data = fs.readFileSync(file.absolutePath)
      const hash = createHash('sha256').update(data).digest('hex')
      const existing = await app.files.getByContentHash(hash)
      if (existing) {
        skipped++
        console.log(
          `  ${c.dim(`[${pad(imported + skipped, files.length)}/${files.length}]`)}  ${c.dim(displayPath)}  ${c.dim('(skipped)')}`,
        )
        continue
      }
    }

    const result = (await daemonCommand(p, 'upload', {
      path: file.absolutePath,
      directory,
    })) as { id: string; name: string; size: number; type: string }

    imported++
    importedBytes += result.size
    const typeBadge = result.type.split('/')[1] ?? result.type
    console.log(
      `  ${c.dim(`[${pad(imported + skipped, files.length)}/${files.length}]`)}  ${displayPath}  ${c.dim(typeBadge)}  ${c.dim(`(${formatBytes(result.size)})`)}`,
    )
  }

  console.log(
    `\nImported ${imported} files (${formatBytes(importedBytes)})` +
      (skipped > 0 ? `, skipped ${skipped}` : ''),
  )
}

type FileEntry = {
  absolutePath: string
  relativePath: string
  size: number
}

function walkDirectory(dir: string, base: string = ''): FileEntry[] {
  const entries: FileEntry[] = []
  const items = fs.readdirSync(dir, { withFileTypes: true })

  for (const item of items) {
    const absPath = path.join(dir, item.name)
    const relPath = base ? path.join(base, item.name) : item.name

    if (item.isDirectory()) {
      entries.push(...walkDirectory(absPath, relPath))
    } else if (item.isFile()) {
      const stat = fs.statSync(absPath)
      entries.push({ absolutePath: absPath, relativePath: relPath, size: stat.size })
    }
  }

  return entries
}

function pad(n: number, total: number): string {
  return String(n).padStart(String(total).length, ' ')
}
