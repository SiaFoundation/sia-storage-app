/*
 * The shapes an OS storage-provider shell exchanges with the core.
 *
 * A shell (a macOS File Provider extension, a Windows sync root, a FUSE mount)
 * holds no database and caches nothing; it turns each OS callback into one call
 * on `app.provider` and renders whatever comes back. These types are the whole
 * vocabulary of that exchange, so they stay flat, JSON-safe, and free of any
 * platform's terminology.
 *
 * File bytes are deliberately absent. They move by path, never through a field
 * here: a whole-file payload would be serialized by the daemon and parsed again
 * by the shell, which for a large file costs several times the file's size in
 * transient memory on both sides.
 */

/** Identifies a directory. The row id alone identifies a file. */
export const DIRECTORY_ID_PREFIX = 'dir:'

/**
 * The scope that spans every folder at once.
 *
 * An OS keeps one view of everything that changed anywhere, alongside the
 * per-folder views. A change scoped to one folder cannot describe a file
 * leaving it, so this view is the only place a move is expressible: the file
 * comes back carrying its new parent, and the OS reparents it.
 *
 * Not a directory row, so it can never collide with a `dir:` identifier.
 */
export const WORKING_SET_ID = 'workingset'

/** Builds the provider identifier for a directory row. */
export function directoryProviderId(directoryId: string): string {
  return `${DIRECTORY_ID_PREFIX}${directoryId}`
}

/** Returns the directory row id for a provider identifier, or null if it names a file. */
export function parseDirectoryProviderId(id: string): string | null {
  return id.startsWith(DIRECTORY_ID_PREFIX) ? id.slice(DIRECTORY_ID_PREFIX.length) : null
}

export type ProviderItemKind = 'file' | 'dir'

/**
 * One entry as the OS sees it.
 *
 * Identifiers carry no path, because the OS requires one to outlive the thing
 * it names: encoding a path makes a rename read as a delete followed by a
 * create, which surfaces as duplicate entries that never go away.
 */
export type ProviderItem = {
  id: string
  /** null for an entry directly under the mount root. */
  parentId: string | null
  name: string
  kind: ProviderItemKind
  /**
   * The library's MIME type; '' for directories. A display fallback: the
   * shell resolves type from the name's extension first, so a name without
   * one still opens as what it is inside the mount.
   */
  mimeType: string
  /** Always 0 for a directory. */
  size: number
  createdAt: number
  /**
   * The edit time, except that a cloud-only file whose thumbnail is on this
   * device reports it one second later, which is what makes Finder ask for a
   * thumbnail it failed to get before.
   */
  modifiedAt: number
  /** Changes when and only when the bytes change; a fixed value makes the OS serve a stale copy forever. */
  contentVersion: string
  /** Changes when and only when some other field changes. */
  metadataVersion: string
  /** An indexer object exists for this file. */
  uploaded: boolean
  uploading: boolean
  /** This version's bytes are on this device: in the cache, or whole in the mount. */
  downloaded: boolean
  downloading: boolean
  /** 0..1, meaningful only while uploading or downloading. */
  progress: number
}

/** One page of a folder listing. `cursor` absent means the listing is complete. */
export type ProviderPage = {
  items: ProviderItem[]
  cursor?: string
  /**
   * Only on a listing's final page: the change anchor covering the whole
   * listing window, for the delta feed to start from. Every scope mints one;
   * without it a cold enumerator would hold no anchor this library accepts.
   */
  anchor?: string
}

/**
 * What changed in a folder since `anchor`. The shell replays this into the OS
 * rather than re-reading the whole folder, so a large library does not
 * re-enumerate on every change.
 */
export type ProviderChanges = {
  items: ProviderItem[]
  deletedIds: string[]
  /** Opaque to the shell; pass it back verbatim on the next call. */
  anchor: string
  /**
   * More is waiting past `anchor`. A shell that reports itself caught up while
   * this is true will not be asked again until the next signal, so whatever was
   * cut off stays invisible until then.
   */
  hasMore: boolean
  /**
   * The anchor cannot be answered from; list the container again instead.
   * `items` and `deletedIds` are empty. Fires for an anchor from another
   * library or format, and for one below the prune horizon; folder renames
   * and deletions arrive as ordinary deltas, never as expiry.
   */
  expired: boolean
}

/** Bytes moved so far for an in-flight transfer. `total` is null until the size is known. */
export type ProviderProgress = {
  received: number
  total: number | null
}

/** Result of placing a file's bytes at a caller-supplied path. */
export type ProviderFetchResult = {
  bytes: number
  item: ProviderItem
}

/**
 * One byte range placed at a caller-supplied path. `offset` and `bytes` are
 * the range actually written, which the shell must report back to the system:
 * a request running past the end of the file is served short.
 */
export type ProviderRangeResult = {
  offset: number
  bytes: number
  /**
   * The version these bytes belong to, which is the current one and may be
   * newer than the one the system asked for.
   */
  item: ProviderItem
}

/**
 * A file's thumbnail for a file browser to draw in place of its icon. `none`
 * means the file can never have one, such as a text file, and a shell may
 * cache that answer until the file's content changes. A file that may get one
 * later is answered with an error instead, so the shell asks again.
 */
export type ProviderThumbnail =
  | { kind: 'image'; mimeType: string; /** The image bytes, base64. */ data: string }
  | { kind: 'none' }

/**
 * What the shell and the daemon agree on before any other call. A shell built
 * against a different daemon serves errors rather than guessing, because the OS
 * caches extensions across upgrades and can pair a stale one with a new daemon.
 */
export type ProviderHello = {
  version: string
  /**
   * Names the library being served, as an identifier rather than a path. The
   * shell compares it for equality, to tell a cache of another library from
   * its own.
   */
  library: string
}

/** Where the last read of the mount's files ended, saved only after a read that succeeded. */
export type MountCursorState = {
  /** The mount the cursor belongs to. */
  mountId: string
  /** The adapter's cursor, to read only what changed after it. */
  cursor: string
  /** When the mount's files were last read whole. */
  fullAt: number
}

/**
 * Files the system now holds whole in the mount, or no longer holds, named by
 * the ids it knows them by. Sent by an integration the system tells about
 * each file, such as a Windows sync root.
 */
export type MountReport = {
  hydrated?: string[]
  dehydrated?: string[]
}
