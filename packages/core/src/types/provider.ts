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
  /** Always 0 for a directory. */
  size: number
  createdAt: number
  modifiedAt: number
  /** Changes when and only when the bytes change; a fixed value makes the OS serve a stale copy forever. */
  contentVersion: string
  /** Changes when and only when some other field changes. */
  metadataVersion: string
  /** An indexer object exists for this file. */
  uploaded: boolean
  uploading: boolean
  /** The bytes are present in managed storage. */
  downloaded: boolean
  downloading: boolean
  /** 0..1, meaningful only while uploading or downloading. */
  progress: number
}

/** One page of a folder listing. `cursor` absent means the listing is complete. */
export type ProviderPage = {
  items: ProviderItem[]
  cursor?: string
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
   * The anchor is too old to answer from; list the folder again instead.
   * `items` and `deletedIds` are empty. A deleted folder leaves no row to name,
   * so a listing, which says what exists rather than what changed, is the only
   * way its disappearance reaches the shell.
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
 * What the shell and the daemon agree on before any other call. A shell built
 * against a different daemon serves errors rather than guessing, because the OS
 * caches extensions across upgrades and can pair a stale one with a new daemon.
 */
export type ProviderHello = {
  version: string
}
