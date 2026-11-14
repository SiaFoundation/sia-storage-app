/*
 * The icon macOS draws for a type of file, for windows that list files the
 * way Finder does.
 *
 * The system hands out a type's icon only for a path, and library files are
 * not on disk under their names, so an empty file with the extension stands
 * in for each type: one per extension, made once under the app's temporary
 * folder. The extension comes from a synced name another device wrote, so
 * anything but a short run of letters and digits gets the plain document's
 * icon rather than a stand-in named after it.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { log } from './log'

const EXTENSION = /^[a-z0-9]{1,16}$/

const icons = new Map<string, Promise<string | null>>()

async function load(extension: string): Promise<string | null> {
  const folder = join(app.getPath('temp'), `${app.getName()} type icons`)
  await mkdir(folder, { recursive: true })
  const path = join(folder, extension ? `file.${extension}` : 'file')
  await writeFile(path, '', { flag: 'a' })
  const icon = await app.getFileIcon(path, { size: 'normal' })
  return icon.isEmpty() ? null : icon.toDataURL({ scaleFactor: 2 })
}

/** The type icon as a data URL, or null when the system gave none. */
export function typeIcon(extension: string): Promise<string | null> {
  const key = EXTENSION.test(extension) ? extension : ''
  let icon = icons.get(key)
  if (!icon) {
    icon = load(key).catch((error: Error) => {
      log.error('shell', 'type_icon_failed', { extension: key, error })
      icons.delete(key)
      return null
    })
    icons.set(key, icon)
  }
  return icon
}
