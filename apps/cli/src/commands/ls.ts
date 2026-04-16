import { getPaths } from '@siastorage/node-adapters'
import { UNFILED_DIRECTORY_ID } from '@siastorage/core/db/operations'
import { ensureDaemonRunning } from '../daemon/supervisor'
import { createDaemonClient } from '../lib/appServiceClient'
import { c, formatBytes, formatRelativeDate, table } from '../lib/format'
import { normalizePath } from '../lib/normalizePath'

export async function lsCommand(
  dataDir: string,
  dirPath?: string,
  _opts?: { sort?: string; type?: string; tag?: string },
) {
  const p = getPaths(dataDir)
  await ensureDaemonRunning(p)
  const app = createDaemonClient(p.sockPath)

  const indexerURL = await app.settings.getIndexerURL()
  let uploadedIds = new Set<string>()
  if (indexerURL) {
    const ids = await app.files.getUploadedIds(indexerURL)
    uploadedIds = new Set(ids)
  }

  if (!dirPath) {
    const directories = await app.directories.getChildren(null)
    const unfiledFiles = await app.files.queryLibrary({
      directoryId: UNFILED_DIRECTORY_ID,
      limit: 200,
    })

    const dirRows: string[][] = directories.map((d: any) => [
      c.cyan(d.name),
      String(d.fileCount ?? 0),
    ])

    if (dirRows.length > 0) {
      console.log(table(['DIRECTORY', 'FILES'], dirRows))
    }

    if (unfiledFiles.length > 0) {
      if (dirRows.length > 0) console.log()
      printFileTable(unfiledFiles, uploadedIds)
    }

    if (dirRows.length === 0 && unfiledFiles.length === 0) {
      console.log(c.dim('No files'))
    }
    return
  }

  const normalized = normalizePath(dirPath)

  const dir = await app.directories.getByPath(normalized)
  if (!dir) {
    console.error(`Directory not found: ${normalized}`)
    process.exit(1)
  }

  const childDirs = await app.directories.getChildren(normalized)
  if (childDirs.length > 0) {
    console.log(
      table(
        ['DIRECTORY', 'FILES'],
        childDirs.map((d: any) => [c.cyan(d.name), String(d.fileCount ?? 0)]),
      ),
    )
  }

  const files = await app.files.queryLibrary({
    directoryId: dir.id,
    limit: 200,
  })

  if (files.length > 0) {
    if (childDirs.length > 0) console.log()
    printFileTable(files, uploadedIds)
  } else if (childDirs.length === 0) {
    console.log(c.dim('No files'))
  }
}

function printFileTable(
  files: Array<{
    id: string
    name: string
    type: string
    size: number
    hash: string
    updatedAt: number
  }>,
  uploadedIds: Set<string>,
) {
  console.log(
    table(
      ['NAME', 'TYPE', 'SIZE', 'STATUS', 'MODIFIED'],
      files.map((f) => {
        const typeColor = f.type.startsWith('image/')
          ? c.cyan
          : f.type.startsWith('video/')
            ? c.magenta
            : f.type.startsWith('audio/')
              ? c.yellow
              : c.dim
        const status =
          f.hash === ''
            ? c.dim('processing')
            : uploadedIds.has(f.id)
              ? c.green('uploaded')
              : c.yellow('local')
        return [
          f.name,
          typeColor(f.type.split('/')[1] ?? f.type),
          formatBytes(f.size),
          status,
          formatRelativeDate(f.updatedAt),
        ]
      }),
    ),
  )
}
