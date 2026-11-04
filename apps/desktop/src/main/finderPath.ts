/*
 * Where a library file sits inside the Finder folder. Names and folders
 * arrive from synced metadata another device wrote, so one that would step
 * outside the folder is refused rather than joined.
 */

import { isAbsolute, join, relative, sep } from 'node:path'

/**
 * The file's path inside the mount, or null when the folder or the name
 * would leave it. A `..` segment, an empty one, or a separator inside a name
 * all count, because each makes the joined path name something other than
 * the item Finder lists.
 */
export function finderPath(mount: string, folder: string | null, name: string): string | null {
  const segments = [...(folder ? folder.split('/') : []), name]
  if (segments.some((s) => s === '' || s === '.' || s === '..' || s.includes(sep))) return null
  const path = join(mount, ...segments)
  const inside = relative(mount, path)
  if (inside === '' || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
    return null
  }
  return path
}
