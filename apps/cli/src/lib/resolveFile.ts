import type { AppService } from '@siastorage/core/app'
import { normalizePath } from './normalizePath'

/**
 * Resolve a file by ID, dir/filename path, or bare name (unfiled files only).
 *
 * - "abc123" → lookup by ID
 * - "photos/dog.jpg" → lookup by name in directory "photos"
 * - "dog.jpg" → lookup by name in unfiled files (no directory)
 */
export async function resolveFile(
  app: Pick<AppService, 'files'>,
  target: string,
): Promise<{ id: string; name: string; [key: string]: unknown } | null> {
  const normalized = normalizePath(target)

  // Try by ID
  const byId = await app.files.getById(normalized)
  if (byId) return byId

  const lastSlash = normalized.lastIndexOf('/')
  if (lastSlash !== -1) {
    const dirPath = normalized.substring(0, lastSlash)
    const fileName = normalized.substring(lastSlash + 1)
    if (fileName) return app.files.getByNameInDirectoryPath(fileName, dirPath)
    return null
  }

  return app.files.getByNameInUnfiled(normalized)
}
