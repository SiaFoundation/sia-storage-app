/*
 * Wraps a signed app in a disk image with an Applications shortcut.
 *
 * A quarantined app that was not moved into place with Finder, including one
 * run straight from the image, runs from a randomized translocation path, and
 * adding its Finder domain there fails with "The application cannot be used
 * from this location". The shortcut is the nudge to drag it to Applications.
 */

import { $ } from 'bun'
import { mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { ARCH } from './darwin'

/** `Sia Storage Beta` at `1.2.0-rc.0` becomes `Sia-Storage-Beta-1.2.0-rc.0-arm64.dmg`. */
export function dmgName(appName: string, version: string, arch = ARCH): string {
  return `${appName.replace(/\s+/g, '-')}-${version}-${arch}.dmg`
}

export async function createDmg(options: {
  appPath: string
  dmgPath: string
  volumeName: string
  signIdentity: string
}): Promise<void> {
  const { appPath, dmgPath, volumeName, signIdentity } = options
  const stage = join(dirname(dmgPath), 'dmg-stage')
  rmSync(stage, { recursive: true, force: true })
  mkdirSync(stage, { recursive: true })
  // ditto rather than cpSync: it keeps the extended attributes and symlinks
  // the signature seals, so the copy verifies the same as the original.
  await $`ditto ${appPath} ${join(stage, basename(appPath))}`
  symlinkSync('/Applications', join(stage, 'Applications'))
  rmSync(dmgPath, { force: true })

  // hdiutil fails with "Resource busy" now and then on a hosted runner while
  // the previous image detaches, and succeeds on the next try.
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    const result =
      await $`hdiutil create -volname ${volumeName} -srcfolder ${stage} -ov -format UDZO -fs HFS+ ${dmgPath}`.nothrow()
    if (result.exitCode === 0) {
      lastError = undefined
      break
    }
    lastError = new Error(`hdiutil create failed: ${result.stderr.toString().trim()}`)
    await Bun.sleep(2000)
  }
  rmSync(stage, { recursive: true, force: true })
  if (lastError) throw lastError

  // Gatekeeper's assessment of an image (`spctl -t open`) rejects one with
  // no signature.
  await $`codesign --force --timestamp --sign ${signIdentity} ${dmgPath}`
}
