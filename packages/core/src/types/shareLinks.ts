/**
 * What a link shows. `latest` follows each file to its newest version and
 * name for as long as the link lasts. `snapshot` shows the versions the
 * files had when it was made: a file still uploading then joins once its
 * upload finishes, or at the version saved over it if that one never
 * uploads, and nothing changes after that.
 */
export type ShareLinkMode = 'latest' | 'snapshot'

/**
 * Where a shared file stands on its link. `pending` until the file's current
 * version is uploaded and attached, `shared` once recipients see it. A file
 * put in the trash leaves the link for good, and restoring it does not put it
 * back.
 */
export type ShareLinkFileState = 'pending' | 'shared'

/**
 * A file as the share views list it. Every list of these from the core is in
 * the same order: the top of the library first, then each folder by path,
 * and by name within a folder, both compared as the library's name sort
 * compares them.
 */
export type ShareFile = {
  fileId: string
  name: string
  size: number
  /** The path of the folder the file is in, or null for the top of the library. */
  folder: string | null
}

export type ShareLinkFile = ShareFile & {
  /**
   * The version the link shows. On a `latest` link that is the current
   * version while the file has one, else the version it was shared as. On a
   * `snapshot` link it is the version it was shared as, or the one saved
   * over it if that one never uploaded.
   */
  fileId: string
  state: ShareLinkFileState
}

/** A link that opens a set of files on the share page, as its `mode` describes. */
export type ShareLink = {
  publicKey: string
  url: string
  createdAt: number
  /** Null for a link that never expires. */
  expiresAt: number | null
  mode: ShareLinkMode
  files: ShareLinkFile[]
}
