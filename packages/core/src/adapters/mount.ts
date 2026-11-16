/*
 * The mount: the folder a file manager shows for this library, a File
 * Provider domain on macOS or a Cloud Files sync root on Windows.
 *
 * The system keeps its own copy of each file opened or created in the mount,
 * and removes them on its own. A host with a mount names it in the `mount`
 * setting. A phone, a plain CLI and a FUSE mount, which keeps no copies of
 * its own, name none.
 */

/** Written by the host app each time it registers the mount. */
export type Mount = {
  /** The mount's identifier: a File Provider domain id, a sync root id. */
  id: string
}
