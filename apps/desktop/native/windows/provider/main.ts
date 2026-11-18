/*
 * The Windows integration: the process behind the library's folder in File
 * Explorer. The desktop app starts it under Bun, the runtime the daemon runs
 * under, for as long as the app runs.
 *
 * `serve` registers the folder as a sync root and connects to it, then joins
 * three things to the folder's logic (`folder.ts`): the daemon, over its
 * provider socket and the mount link held open on it, the callbacks Windows
 * makes (`cloudFiles.ts`), and a watch on the folder for what Windows has no
 * callback for. It prints `ready` once the folder is served, and ends when
 * its standard input closes, which is how the app stops it and what happens
 * when the app dies. `remove` takes the folder away, for sign-out, and
 * leaves behind any file in it that the daemon was never sent.
 *
 * usage: bun main.ts serve <folder> <mount id> <display name> <icon>
 *        bun main.ts remove <folder> <mount id>
 *
 * `serve` reads the daemon's provider socket and the handoff directory from
 * SIA_PROVIDER_SOCKET and SIA_HANDOFF_DIR, as the daemon does. Both modes log
 * to provider.log in SIA_DATA_DIR.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, watch } from 'node:fs'
import { join } from 'node:path'
import { type ProviderChanges, WORKING_SET_ID } from '@siastorage/core/types'
import { addAppender, formatPlainLog, logger } from '@siastorage/logger'
import { sendIpcCommand } from '@siastorage/node-adapters/ipc'
import { type HeldMountLink, holdMountLink } from '@siastorage/node-adapters/mountLink'
import { connectCloudFiles } from './cloudFiles'
import { createFolder, prune } from './folder'
import { registerSyncRoot, syncRootRegistered, unregisterSyncRoot } from './syncRoot'

/** How often the callbacks Windows queued are taken. A read waits on this. */
const POLL_MS = 10
/**
 * How long a path has to go unchanged before it is examined. A program
 * saving a file changes it several times in a row.
 */
const QUIET_MS = 500
const CHANGES_POLL_MS = 1000
/** A save sends the whole file, which the daemon hashes before it answers. */
const CALL_TIMEOUT_MS = 5 * 60_000
/** A range not served within the system's 60 second fetch timeout is of no use. */
const FETCH_TIMEOUT_MS = 60_000

const failed = (event: string) => (e: unknown) =>
  logger.error('provider', event, { error: e as Error })

async function serve(root: string, mountId: string, name: string, icon: string): Promise<never> {
  const { SIA_PROVIDER_SOCKET: socket, SIA_HANDOFF_DIR: handoffDir } = process.env
  if (!socket || !handoffDir) {
    throw new Error('SIA_PROVIDER_SOCKET and SIA_HANDOFF_DIR must be set')
  }
  // A folder by this name with files in it that is not the app's sync root
  // is the user's own, and is left as it is. The app reads `taken` as a
  // reason not to start the provider again.
  if (existsSync(root) && readdirSync(root).length > 0 && !syncRootRegistered(mountId)) {
    logger.error('provider', 'folder_taken', { root })
    process.stdout.write('taken\n')
    process.exit(1)
  }
  mkdirSync(root, { recursive: true })
  mkdirSync(handoffDir, { recursive: true })
  registerSyncRoot(root, mountId, name, icon)
  const cloud = connectCloudFiles(root)
  const daemon = <T>(method: string, ...args: unknown[]) =>
    sendIpcCommand(
      socket,
      `ds:provider:${method}`,
      { args },
      method === 'fetchRange' ? FETCH_TIMEOUT_MS : CALL_TIMEOUT_MS,
    ) as Promise<T>
  const folder = createFolder({ root, handoffDir, cloud, daemon })

  // Windows gives a process no signal it can catch, and a provider left
  // connected to the sync root keeps the app's next one from connecting.
  process.stdin.on('close', () => {
    cloud.disconnect()
    process.exit(0)
  })
  process.stdin.resume()

  /** Paths that changed, by when each is due to be examined. */
  const due = new Map<string, number>()
  const watcher = watch(root, { recursive: true }, (_event, rel) => {
    // No name means Windows had more changes than it could hold, and
    // dropped them.
    if (rel === null) folder.scan().catch(failed('scan_failed'))
    else due.set(rel, Date.now() + QUIET_MS)
  })
  // With no watch, changes made in the folder go unseen. The app starts a
  // provider that exits again.
  watcher.on('error', (e) => {
    failed('watch_failed')(e)
    process.exit(1)
  })
  setInterval(() => {
    // Callbacks before paths: a rename's callback moves the entry, and the
    // old path examined first would read as the file having left the folder.
    for (let event = cloud.poll(); event; event = cloud.poll()) {
      folder.handle(event).catch(failed('callback_failed'))
    }
    const now = Date.now()
    for (const [rel, at] of due) {
      if (at > now) continue
      due.delete(rel)
      folder.examine(rel).catch((e) => {
        // A program still writing the file holds it, and its close is
        // another change to the path.
        if ((e as NodeJS.ErrnoException).code !== 'EBUSY') failed('examine_failed')(e)
      })
    }
  }, POLL_MS)
  setInterval(() => folder.touchOpened().catch(failed('touch_failed')), CHANGES_POLL_MS)

  process.stdout.write('ready\n')
  logger.info('provider', 'serving', { root, mountId })

  // One pass per connection to the daemon, which restarts under the app. The
  // rebuild that starts a pass sends a save or a new file whose call failed
  // while the daemon was away. A rename or a delete that failed is not sent
  // again, and the rebuild puts the library's side back.
  let link: HeldMountLink | undefined
  let failing = false
  for (;;) {
    try {
      link = await holdMountLink(socket, folder.answer)
      failing = false
      // The app can have a killed daemon running again before the next poll
      // below, so no call fails, and only the old link ending says the new
      // daemon has none.
      let linked = true
      void link.closed.then(() => {
        linked = false
      })
      // The app's setup view shows the folders as being prepared until this pass ends.
      await sendIpcCommand(socket, 'warm', { args: ['start'] })
      let anchor = await folder.refresh()
      await sendIpcCommand(socket, 'warm', { args: ['settled'] })
      // The daemon asks for the files the folder holds when the link
      // attaches, which can be before this rebuild ends. Asking again reads
      // what the rebuild left.
      await daemon('mountChanged')
      while (linked) {
        const page = await daemon<ProviderChanges>('changes', WORKING_SET_ID, anchor)
        if (page.expired) {
          anchor = await folder.refresh()
          continue
        }
        await folder.changes(page)
        anchor = page.anchor
        if (!page.hasMore) await Bun.sleep(CHANGES_POLL_MS)
      }
    } catch (e) {
      // Logged when a pass first fails, not on each try after it.
      if (!failing) failed('pass_failed')(e)
      failing = true
    }
    link?.close()
    await Bun.sleep(CHANGES_POLL_MS)
  }
}

/**
 * Unregisters the folder and deletes what the library holds of it. A file
 * the daemon was never sent is left where it is, in what is then a plain
 * folder: one saved moments before, one made while the daemon was down, a
 * program's temporary file.
 */
function remove(root: string, mountId: string): void {
  // A folder by this name that was never registered is the user's own.
  if (!syncRootRegistered(mountId)) return
  if (existsSync(root)) {
    // Telling a placeholder from a plain file needs the sync root still registered.
    const cloud = connectCloudFiles(root)
    if (!prune(cloud, root)) logger.info('provider', 'kept_unsent_files', { root })
    cloud.disconnect()
  }
  unregisterSyncRoot(mountId)
}

const [mode, root, mountId, name, icon] = process.argv.slice(2)
const dataDir = process.env.SIA_DATA_DIR
if (dataDir) {
  const logFile = join(dataDir, 'provider.log')
  addAppender({ write: (entry) => appendFileSync(logFile, `${formatPlainLog(entry)}\n`) })
}
if (mode === 'serve') await serve(root, mountId, name, icon)
else if (mode === 'remove') remove(root, mountId)
else throw new Error('usage: bun main.ts serve|remove <folder> <mount id> [<display name> <icon>]')
