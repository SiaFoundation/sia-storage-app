/*
 * Asking the operating system about the mount: the folder a file manager
 * shows for this library, a File Provider domain on macOS or a Cloud Files
 * sync root on Windows.
 *
 * The system keeps its own copy of each file opened or created in the mount,
 * and only the system can remove one. This adapter is how the eviction pass
 * asks it to, how the pass learns which files the system holds and which it
 * removed on its own, and how a file's bytes are brought back from the mount
 * when the cache has none to upload from. A host with a mount passes one. A
 * phone, a plain CLI and a FUSE mount, which keeps no copies of its own, pass
 * none.
 */

/** Written by the host app each time it registers the mount. */
export type Mount = {
  /** The mount's identifier: a File Provider domain id, a sync root id. */
  id: string
  /**
   * Whatever the host's adapter needs to act on the mount, stored for it
   * unread. On macOS, the absolute path of the Finder agent inside the
   * installed app.
   */
  adapterConfig?: string
}

/**
 * What the system did with one file it was asked to dehydrate:
 * - `done`: its copy is gone, or it held none.
 * - `refused`: the system's record of the file does not let it go, such as a
 *   file it counts as not uploaded or one the user pinned. That record
 *   changes rarely.
 * - `busy`: the copy stays for now for any other reason, such as the file
 *   being open in an app.
 */
export type DehydrateResult = 'done' | 'refused' | 'busy'

/**
 * What the system answered when asked to hand a file's bytes back:
 * - `asked`: it will call the integration with the bytes, which arrive as a
 *   `provider.write`. Nothing says when.
 * - `not-hydrated`: the mount does not hold the file whole.
 * - `failed`: any other answer.
 */
export type ResendResult = 'asked' | 'not-hydrated' | 'failed'

/**
 * The files the system holds whole. A full read sets `full`. A read of
 * changes since a cursor sets `added` and `removed`, or `full` when the
 * system would not read changes from that cursor and listed everything.
 */
export type MountChanges = {
  /** Pass this back to read only what changed after this call. */
  cursor: string
  full?: string[]
  added?: string[]
  removed?: string[]
}

export type MountAdapter = {
  /**
   * Asks the system to remove its copies of the files `stackIds` names, at
   * most `MOUNT_DEHYDRATE_BATCH` per call, and returns each file's result.
   * Rejects when the call could not run at all, such as a missing app, an
   * unknown mount, a timeout or `signal` aborting, and then reports none of
   * the call's results.
   */
  dehydrate(
    mount: Mount,
    stackIds: string[],
    signal?: AbortSignal,
  ): Promise<Record<string, DehydrateResult>>
  /**
   * Asks the system to hand back the bytes of the files `stackIds` names.
   * Each one it agrees to arrives later as a `provider.write` carrying a
   * snapshot of the mount's copy. Rejects as `dehydrate` does.
   */
  resend(
    mount: Mount,
    stackIds: string[],
    signal?: AbortSignal,
  ): Promise<Record<string, ResendResult>>
  /**
   * Reads which files the system holds whole: all of them with no `cursor`,
   * or what changed since it. Resolves null where the integration reports
   * each change as it happens instead (`provider.mountReport`). Rejects as
   * `dehydrate` does.
   */
  changes(mount: Mount, cursor: string | null, signal?: AbortSignal): Promise<MountChanges | null>
}
