/*
 * Puts the app where the system will actually load its extension from.
 *
 * PluginKit discovers an extension only inside an app LaunchServices knows
 * about, which means /Applications. Run from a build directory the app launches
 * and the mount never appears.
 *
 * This is the iterate-and-install loop, not a distributable installer: it
 * replaces whatever is at the destination and restarts fileproviderd.
 */

import { $ } from 'bun'
import {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

/**
 * Puts a `sia` on PATH that runs the installed app's own daemon binary.
 *
 * Reports whether it is the one a shell would actually run. `apps/cli/install.sh`
 * installs to `~/.sia/bin` and prepends that to PATH, so with both installed the
 * standalone CLI wins and the two can be different builds against one library,
 * which is the thing worth knowing about.
 */
export function linkCli(appPath: string): {
  path: string
  effective: boolean
  shadowedBy: string | null
  occupied: boolean
} {
  const resources = join(appPath, 'Contents', 'Resources')
  const binDir = join(homedir(), '.local', 'bin')
  const target = join(binDir, 'sia')
  mkdirSync(binDir, { recursive: true })
  // Only a missing file or this app's own previous shim is replaced. Anything
  // else at the path, a binary or a symlink, is something the user installed,
  // and deleting it would remove a command of theirs from PATH.
  if (!replaceableShim(target)) {
    return { ...resolveCli(process.env.PATH ?? '', target, isExecutableFile), occupied: true }
  }
  rmSync(target, { force: true })
  writeFileSync(
    target,
    `#!/bin/sh\nexec "${join(resources, 'bun')}" "${join(resources, 'daemon.js')}" "$@"\n`,
    { mode: 0o755 },
  )
  return { ...resolveCli(process.env.PATH ?? '', target, isExecutableFile), occupied: false }
}

/** Whether the path is free, or holds a shim this packaging wrote before. */
export function replaceableShim(target: string): boolean {
  let stat
  try {
    stat = lstatSync(target)
  } catch {
    return true
  }
  if (!stat.isFile()) return false
  try {
    const content = readFileSync(target, 'utf8')
    return content.startsWith('#!/bin/sh\n') && content.includes('daemon.js')
  } catch {
    return false
  }
}

/**
 * Which `sia` a shell runs: the first runnable one on PATH, which need not be
 * the shim. Runnable, not merely present, because command lookup skips a
 * directory or a file without execute permission.
 */
export function resolveCli(
  pathEnv: string,
  target: string,
  runnable: (path: string) => boolean,
): { path: string; effective: boolean; shadowedBy: string | null } {
  const winner = pathEnv
    .split(':')
    .filter(Boolean)
    .map((dir) => join(dir, 'sia'))
    .find(runnable)
  return {
    path: target,
    effective: winner === target,
    shadowedBy: winner && winner !== target ? winner : null,
  }
}

export async function install(appPath: string): Promise<string> {
  const destination = join('/Applications', basename(appPath))

  await $`osascript -e ${`quit app "${basename(appPath, '.app')}"`}`.nothrow()
  // The app attaches to whichever daemon is serving, so a reinstall would leave
  // the previous build's running. Matched on the installed path only.
  await $`pkill -f ${join(destination, 'Contents', 'Resources', 'daemon.js')}`.nothrow()
  // The quit above is asynchronous: the app tears its mount and daemon down
  // before exiting, and replacing the bundle under a live process leaves the
  // old build running against the new files.
  await waitForExit(join(destination, 'Contents', 'MacOS'), 'The installed app')
  // The daemon has its own tail: after SIGTERM it drains uploads, closes the
  // database and releases its lock, and replacing the bundle under it leaves
  // the next launch attached to a daemon about to exit.
  await waitForExit(join(destination, 'Contents', 'Resources', 'daemon.js'), 'The daemon')
  // Replaced rather than copied over: a merge would leave the old build's files
  // inside the new signature, which fails `codesign --verify`.
  rmSync(destination, { recursive: true, force: true })
  await $`cp -R ${appPath} ${destination}`

  await $`/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f -R ${destination}`.nothrow()
  // fileproviderd caches the extension binary; without this it keeps running the
  // previous build and the change under test never takes effect.
  await $`killall fileproviderd`.nothrow()

  return destination
}

/**
 * Starts the installed app. Separate from copying it in because PluginKit
 * registers the extension on first launch rather than on the copy, and because
 * the caller decides what the process starts with.
 *
 * `open` gives the app a normal launch context, which does not include the
 * shell's environment, so anything the process needs is passed explicitly.
 */
export async function launch(appPath: string, env: Record<string, string> = {}): Promise<void> {
  const flags = Object.entries(env).flatMap(([key, value]) => ['--env', `${key}=${value}`])
  await $`open ${flags} ${appPath}`
}

function isExecutableFile(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return statSync(path).isFile()
  } catch {
    return false
  }
}

async function waitForExit(processPathPrefix: string, what: string): Promise<void> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const alive = await $`pgrep -f ${processPathPrefix}`.nothrow().text()
    if (!alive.trim()) return
    await Bun.sleep(200)
  }
  throw new Error(`${what} did not exit; stop it and rerun`)
}

/** Reports whether PluginKit has actually registered the extension. */
export async function isExtensionRegistered(extBundleId: string): Promise<boolean> {
  const listed = await $`pluginkit -m -p com.apple.fileprovider-nonui`.nothrow().text()
  return listed.includes(extBundleId)
}

if (import.meta.main) {
  const appPath = process.argv[2]
  if (!appPath || !existsSync(appPath)) {
    console.error('Usage: install.ts <path to .app>')
    process.exit(1)
  }
  console.log(await install(appPath))
}
