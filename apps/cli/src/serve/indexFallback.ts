import { UNFILED_DIRECTORY_ID } from '@siastorage/core/db/operations'
import type { CliApp } from '../app'

/**
 * The root has no directory row in the database; root-level files live as
 * "unfiled" rows. Look them up by name via the library query.
 */
async function findUnfiledFileByName(
  app: CliApp,
  name: string,
): Promise<{ id: string; name: string; type: string; size: number; hash: string } | null> {
  const files = await app.service.files.queryLibrary({
    directoryId: UNFILED_DIRECTORY_ID,
    limit: 500,
  })
  return files.find((f) => f.name === name) ?? null
}

/** Check if index.html exists at the given path and return the file record if so. */
export async function resolveIndexHtml(
  app: CliApp,
  dirPath: string,
): Promise<{ id: string; name: string; type: string; size: number; hash: string } | null> {
  if (dirPath === '') return findUnfiledFileByName(app, 'index.html')
  return app.service.files.getByNameInDirectoryPath('index.html', dirPath)
}

/** Try appending .html to a path segment to support clean URLs. */
export async function resolveCleanUrl(
  app: CliApp,
  fileName: string,
  dirPath: string,
): Promise<{ id: string; name: string; type: string; size: number; hash: string } | null> {
  if (dirPath === '') return findUnfiledFileByName(app, fileName + '.html')
  return app.service.files.getByNameInDirectoryPath(fileName + '.html', dirPath)
}

/**
 * Walk up the directory tree within the route boundary looking for index.html.
 * Returns the file record and the directory path where it was found.
 */
export async function resolveSpaFallback(
  app: CliApp,
  path: string,
  routePath: string,
): Promise<{
  file: { id: string; name: string; type: string; size: number; hash: string }
  dirPath: string
} | null> {
  // Start from the deepest directory in the path and walk up
  const parts = path.split('/')
  // Remove the last segment (the unresolved "file" part)
  parts.pop()

  while (parts.length > 0) {
    const candidate = parts.join('/')
    // Don't walk above the route boundary
    if (!candidate.startsWith(routePath) && candidate !== routePath) break

    const index = await resolveIndexHtml(app, candidate)
    if (index) return { file: index, dirPath: candidate }
    parts.pop()
  }

  // Try the route root itself (including the empty-path root, which falls back
  // to unfiled files via resolveIndexHtml).
  const index = await resolveIndexHtml(app, routePath)
  if (index) return { file: index, dirPath: routePath }

  return null
}
