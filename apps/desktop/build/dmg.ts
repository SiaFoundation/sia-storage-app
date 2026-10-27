/*
 * Wraps a signed app in a disk image whose window asks you to drag it to
 * Applications.
 *
 * A quarantined app that was not moved into place with Finder, including one
 * run straight from the image, runs from a randomized translocation path, and
 * adding its Finder domain there fails with "The application cannot be used
 * from this location".
 *
 * Finder lays a folder out as a grid unless the volume carries its own window
 * layout. The layout is written while the image is mounted, because the
 * background picture has to point at the file on that volume.
 */

import { $ } from 'bun'
import { copyFileSync, existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { installerLayout } from './dmg-layout'

const backgroundScript = join(dirname(fileURLToPath(import.meta.url)), 'dmg-background.swift')

// Finder drops a picture and icon positions set on a window it has not
// closed, so this closes the window and applies them again before reading
// the positions back.
const arrangeScript = `
on run argv
	set mountPoint to item 1 of argv
	set appName to item 2 of argv
	set winX to item 3 of argv as integer
	set winY to item 4 of argv as integer
	set winW to item 5 of argv as integer
	set winH to item 6 of argv as integer
	set iconSize to item 7 of argv as integer
	set appX to item 8 of argv as integer
	set appY to item 9 of argv as integer
	set applicationsX to item 10 of argv as integer
	set applicationsY to item 11 of argv as integer
	set backgroundPath to mountPoint & "/.background/background.png"
	tell application "Finder"
		set theDisk to disk of (POSIX file mountPoint as alias)
		open theDisk
		delay 0.3
		tell container window of theDisk
			set current view to icon view
			set toolbar visible to false
			set statusbar visible to false
			set the bounds to {winX, winY, winX + winW, winY + winH}
		end tell
		set opts to the icon view options of container window of theDisk
		tell opts
			set icon size to iconSize
			set text size to 12
			set arrangement to not arranged
			set background picture to POSIX file backgroundPath
		end tell
		set position of item appName of container window of theDisk to {appX, appY}
		set position of item "Applications" of container window of theDisk to {applicationsX, applicationsY}
		set extension hidden of item appName of container window of theDisk to true
		close container window of theDisk
		delay 0.4
		open theDisk
		delay 0.3
		tell container window of theDisk
			set the bounds to {winX, winY, winX + winW - 8, winY + winH - 8}
		end tell
		delay 0.2
		tell container window of theDisk
			set toolbar visible to false
			set statusbar visible to false
			set the bounds to {winX, winY, winX + winW, winY + winH}
		end tell
		set opts to the icon view options of container window of theDisk
		tell opts
			set icon size to iconSize
			set arrangement to not arranged
			set background picture to POSIX file backgroundPath
		end tell
		set position of item appName of container window of theDisk to {appX, appY}
		set position of item "Applications" of container window of theDisk to {applicationsX, applicationsY}
		set appPos to position of item appName of container window of theDisk
		set applicationsPos to position of item "Applications" of container window of theDisk
		close container window of theDisk
		return (item 1 of appPos as text) & "," & (item 2 of appPos as text) & " " & (item 1 of applicationsPos as text) & "," & (item 2 of applicationsPos as text)
	end tell
end run
`

export async function createDmg(options: {
  appPath: string
  dmgPath: string
  volumeName: string
  signIdentity: string
}): Promise<void> {
  const { appPath, dmgPath, volumeName, signIdentity } = options
  const layout = installerLayout(volumeName)
  const work = dirname(dmgPath)
  const stage = join(work, 'dmg-stage')
  const mount = join(work, 'dmg-mount')
  const writable = join(work, 'dmg-rw.dmg')
  const appName = basename(appPath)

  rmSync(stage, { recursive: true, force: true })
  mkdirSync(join(stage, '.background'), { recursive: true })
  // ditto rather than cpSync: it keeps the extended attributes and symlinks
  // the signature seals, so the copy verifies the same as the original.
  await $`ditto ${appPath} ${join(stage, appName)}`
  symlinkSync('/Applications', join(stage, 'Applications'))
  await drawBackground(join(stage, '.background', 'background.png'), layout)
  const icon = join(appPath, 'Contents', 'Resources', 'icon.icns')
  if (existsSync(icon)) copyFileSync(icon, join(stage, '.VolumeIcon.icns'))

  rmSync(dmgPath, { force: true })
  rmSync(writable, { force: true })
  await hdiutil(
    [
      'create',
      '-volname',
      volumeName,
      '-srcfolder',
      stage,
      '-ov',
      '-format',
      'UDRW',
      '-fs',
      'HFS+',
      writable,
    ],
    'hdiutil create',
  )

  mkdirSync(mount, { recursive: true })
  let attached = false
  try {
    await hdiutil(
      [
        'attach',
        '-readwrite',
        '-noverify',
        '-noautoopen',
        '-nobrowse',
        '-mountpoint',
        mount,
        writable,
      ],
      'hdiutil attach',
    )
    attached = true
    await arrange(mount, appName, layout)
    if (existsSync(join(mount, '.VolumeIcon.icns'))) await markVolumeIcon(mount)
    await Bun.sleep(400)
    if (!existsSync(join(mount, '.DS_Store')))
      throw new Error('Finder did not write the window layout')
    await detach(mount)
    attached = false
    await hdiutil(
      ['convert', writable, '-format', 'UDZO', '-imagekey', 'zlib-level=9', '-ov', '-o', dmgPath],
      'hdiutil convert',
    )
  } finally {
    if (attached) {
      try {
        await detach(mount)
        attached = false
      } catch {
        // A throw here replaces the failure from the try above.
      }
    }
    rmSync(stage, { recursive: true, force: true })
    if (!attached) rmSync(mount, { recursive: true, force: true })
    rmSync(writable, { force: true })
  }

  // Gatekeeper's assessment of an image (`spctl -t open`) rejects one with
  // no signature.
  await $`codesign --force --timestamp --sign ${signIdentity} ${dmgPath}`
}

async function drawBackground(
  out: string,
  layout: ReturnType<typeof installerLayout>,
): Promise<void> {
  const result =
    await $`swift ${backgroundScript} ${out} ${layout.caption} ${layout.background.width} ${layout.background.height} ${layout.captionBaseline} ${layout.arrow.x1} ${layout.arrow.x2} ${layout.arrow.y} ${layout.arrow.bow}`.nothrow()
  if (result.exitCode !== 0) {
    throw new Error(`background drawing failed: ${result.stderr.toString().trim()}`)
  }
}

async function arrange(
  mount: string,
  appName: string,
  layout: ReturnType<typeof installerLayout>,
): Promise<void> {
  const { window, iconSize, app, applications } = layout
  const reported = await runOsascript(arrangeScript, [
    mount,
    appName,
    String(window.x),
    String(window.y),
    String(window.width),
    String(window.height),
    String(iconSize),
    String(app.x),
    String(app.y),
    String(applications.x),
    String(applications.y),
  ])
  const [gotApp, gotApplications] = reported.split(' ').map(parsePoint)
  if (!gotApp || !gotApplications || !near(gotApp, app) || !near(gotApplications, applications)) {
    throw new Error(`Finder did not keep the icon positions: ${reported}`)
  }
}

function parsePoint(text: string): { x: number; y: number } | undefined {
  const [x, y] = text.split(',').map(Number)
  if (x === undefined || y === undefined || Number.isNaN(x) || Number.isNaN(y)) return undefined
  return { x, y }
}

function near(got: { x: number; y: number }, want: { x: number; y: number }): boolean {
  return Math.abs(got.x - want.x) <= 2 && Math.abs(got.y - want.y) <= 2
}

async function markVolumeIcon(mount: string): Promise<void> {
  // kHasCustomIcon in the volume's Finder info. Without it Finder keeps the
  // generic disk icon and ignores .VolumeIcon.icns.
  const flags = '0000000000000000040000000000000000000000000000000000000000000000'
  const result = await $`xattr -wx com.apple.FinderInfo ${flags} ${mount}`.nothrow()
  if (result.exitCode !== 0) {
    throw new Error(`volume icon failed: ${result.stderr.toString().trim()}`)
  }
}

async function detach(mount: string): Promise<void> {
  if (!existsSync(mount)) return
  try {
    await hdiutil(['detach', mount], 'hdiutil detach')
  } catch {
    await hdiutil(['detach', '-force', mount], 'hdiutil detach')
  }
}

// hdiutil fails with "Resource busy" now and then on a hosted runner while
// the previous image detaches, and succeeds on the next try.
async function hdiutil(args: string[], label: string): Promise<void> {
  let last = ''
  for (let attempt = 0; attempt < 3; attempt++) {
    const proc = Bun.spawn(['hdiutil', ...args], { stdout: 'pipe', stderr: 'pipe' })
    const stdout = new Response(proc.stdout).text()
    const stderr = new Response(proc.stderr).text()
    const [errText, code] = await Promise.all([stderr, proc.exited, stdout])
    if (code === 0) return
    last = errText.trim()
    if (!last.includes('Resource busy') || attempt === 2) break
    await Bun.sleep(2000)
  }
  throw new Error(`${label} failed: ${last}`)
}

async function runOsascript(script: string, args: string[]): Promise<string> {
  const proc = Bun.spawn(['osascript', '-', ...args], {
    stdin: Buffer.from(script),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (code !== 0) throw new Error(`Finder layout failed: ${stderr.trim() || stdout.trim()}`)
  return stdout.trim()
}
