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
 * version is uploaded and attached, `shared` once recipients see it, and
 * `trashed` while every version is in the trash, which takes it off the link
 * until it is restored.
 */
export type ShareLinkFileState = 'pending' | 'shared' | 'trashed'

export type ShareLinkFile = {
  /**
   * The version the link shows. On a `latest` link that is the current
   * version while the file has one, else the version it was shared as. On a
   * `snapshot` link it is the version it was shared as, or the one saved
   * over it if that one never uploaded.
   */
  fileId: string
  name: string
  size: number
  /** The path of the folder the file is in, or null for the top of the library. */
  folder: string | null
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
