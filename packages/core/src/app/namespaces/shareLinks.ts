/*
 * Share links: sharing keys on the indexer that open a set of files on the
 * share page. A `latest` link shows each file at its current version and name,
 * and a `snapshot` link at the version it was shared as.
 *
 * The indexer is the record. It keeps every key, gives any device signed in to
 * the account each key's seed back, and lists the objects attached to each
 * key. Nothing there follows a file, though: a new version is a new object,
 * and an attachment keeps the metadata it was made with until it is attached
 * again. `syncLinks` does the following for a `latest` link. For each shared
 * file it attaches the current version, attaches it again after a rename, and
 * detaches the versions it replaced and the file itself while it is trashed.
 * A `snapshot` link attaches the version each file was shared as once it is
 * uploaded, and detaches and reattaches it as the file is trashed and restored.
 *
 * Two devices can sync one link at once. Each attaches only the version it
 * holds as current, which is the newest live row by (updatedAt, id) on both,
 * and never detaches an object it has no row for, so a version another device
 * attached first is left alone until this device has synced it.
 */
import { logger } from '@siastorage/logger'
import type { DatabaseAdapter } from '../../adapters/db'
import type { SdkAdapter, SharingKeyRef } from '../../adapters/sdk'
import { SHARE_LINK_URL_PREFIX, SHARE_LINKS_REFRESH_INTERVAL } from '../../config'
import * as ops from '../../db/operations'
import { decodeFileMetadata, encodeFileMetadata } from '../../encoding/fileMetadata'
import { hexToUint8, uint8ToHex } from '../../lib/hex'
import type { FileRecordRow } from '../../types/files'
import type { ShareLink, ShareLinkFile, ShareLinkMode } from '../../types/shareLinks'
import type { AppService } from '../service'

const PAGE_SIZE = 100
/**
 * The indexer stores a key's description in plaintext, and it cannot be
 * changed later, so it names the app and nothing about the files. It is also
 * the one place another device of the account can read a link's mode from.
 * A key made before modes existed, or by another app, reads as `latest`.
 */
const DESCRIPTIONS: Record<ShareLinkMode, string> = {
  latest: 'Sia Storage',
  snapshot: 'Sia Storage snapshot',
}

function modeOf(description: string): ShareLinkMode {
  return description === DESCRIPTIONS.snapshot ? 'snapshot' : 'latest'
}

type ShareLinkMethods = Pick<
  AppService['shares'],
  'createLink' | 'links' | 'addLinkFiles' | 'removeLinkFiles' | 'revokeLink' | 'syncLinks'
>

type Deps = {
  db: DatabaseAdapter
  requireSdk: () => SdkAdapter
  getIndexerURL: () => Promise<string>
  /** Called after any change a list of links would show. */
  invalidate: () => void
}

function keyOf(link: ops.ShareLinkRow): SharingKeyRef {
  return { publicKey: link.publicKey, seed: hexToUint8(link.seed) }
}

/** A stack's identity, as queryFileVersions takes it. */
function stackOf(row: { name: string | null; directoryId: string | null }): string {
  return JSON.stringify([row.directoryId, row.name])
}

/**
 * The metadata attached for recipients: the file's id, name, type, size,
 * content hash and created and updated times. Tags, the folder and the trash
 * time are left out and stay private.
 */
function sharedMetadata(row: FileRecordRow): ArrayBuffer {
  return encodeFileMetadata({
    id: row.id,
    name: row.name,
    type: row.type,
    kind: 'file',
    size: row.size,
    hash: row.hash,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    trashedAt: null,
  })
}

/** Reads every page of an offset-paged listing. */
async function allPages<T>(read: (offset: number) => Promise<T[]>): Promise<T[]> {
  const all: T[] = []
  for (;;) {
    const page = await read(all.length)
    all.push(...page)
    if (page.length < PAGE_SIZE) return all
  }
}

function isGoneError(e: unknown): boolean {
  const message = e instanceof Error ? e.message.toLowerCase() : String(e).toLowerCase()
  return message.includes('not found')
}

export function buildShareLinks(deps: Deps): ShareLinkMethods {
  const { db } = deps
  let refreshedAt = 0
  // Every operation that reads a link's state and then changes it on the
  // indexer runs one at a time. Without this, the background pass could
  // attach a file's new version between a removal's detach and its delete of
  // the file's row, and the file would stay on the link.
  let queue: Promise<unknown> = Promise.resolve()
  // A sync pass queued and not yet started. Callers arriving meanwhile share it
  // rather than queueing one pass each, which a window opening twice and the
  // scheduled pass would otherwise do, each holding up a link being made.
  let waitingPass: { refresh: boolean; done: Promise<void> } | null = null
  function exclusive<T>(run: () => Promise<T>): Promise<T> {
    const next = queue.then(run, run)
    queue = next.catch(() => {})
    return next
  }

  /** One version row per stack, skipping stacks in `taken` and anything that is not a live file. */
  async function distinctFiles(fileIds: string[], taken = new Set<string>()): Promise<string[]> {
    const picked: string[] = []
    for (const fileId of fileIds) {
      const row = await ops.queryFileById(db, fileId)
      if (!row || row.kind !== 'file' || row.deletedAt !== null) continue
      const stack = await ops.queryFileStackKey(db, fileId)
      if (!stack) continue
      const id = stackOf(stack)
      if (taken.has(id)) continue
      taken.add(id)
      picked.push(fileId)
    }
    return picked
  }

  async function refresh(sdk: SdkAdapter, indexerURL: string): Promise<void> {
    const startedAt = Date.now()
    const records = await allPages((offset) => sdk.sharingKeys(offset, PAGE_SIZE))
    const listed = new Map(records.map((r) => [r.key.publicKey, r]))
    let changed = false

    const local = await ops.queryShareLinks(db, indexerURL)
    const known = new Set(local.map((l) => l.publicKey))
    for (const link of local) {
      // Missing from the listing means revoked or expired. A link made after
      // the listing was requested is not in it yet.
      if (listed.has(link.publicKey) || link.createdAt >= startedAt) continue
      await ops.deleteShareLink(db, link.publicKey)
      changed = true
    }
    for (const r of records) {
      if (!known.has(r.key.publicKey)) {
        await ops.insertShareLink(db, {
          publicKey: r.key.publicKey,
          seed: uint8ToHex(r.key.seed),
          indexerURL,
          createdAt: r.createdAt.getTime(),
          expiresAt: r.expiresAt?.getTime() ?? null,
          mode: modeOf(r.description),
        })
        changed = true
      }
      const objects = await allPages((offset) => sdk.sharedObjects(r.key, offset, PAGE_SIZE))
      // Each attachment's metadata carries the updatedAt of the version it
      // was attached with, whichever device attached it.
      const replaced = await ops.replaceShareLinkObjects(
        db,
        r.key.publicKey,
        objects.map((o) => ({
          objectId: o.id(),
          sharedUpdatedAt: decodeFileMetadata(o.metadata()).updatedAt || null,
        })),
      )
      const adopted = await adoptFiles(r.key.publicKey, indexerURL)
      if (replaced || adopted) changed = true
    }
    refreshedAt = startedAt
    if (changed) deps.invalidate()
  }

  /**
   * Brings this device's list of a link's files in line with what is
   * attached. A file another device attached is added. A file this device saw
   * on the link with no version of it attached any more was taken off on
   * another device, or deleted, and is dropped. Returns whether anything
   * changed.
   */
  async function adoptFiles(publicKey: string, indexerURL: string): Promise<boolean> {
    const files = await ops.queryShareLinkFileStacks(db, publicKey)
    const attached = await ops.queryShareLinkObjectFiles(db, publicKey, indexerURL)
    const fileStacks = new Set(files.filter((f) => f.name !== null).map(stackOf))
    let changed = false
    for (const object of attached) {
      if (object.fileId === null || fileStacks.has(stackOf(object))) continue
      await ops.insertShareLinkFile(db, publicKey, object.fileId, 'shared')
      fileStacks.add(stackOf(object))
      changed = true
    }
    // An object this device has not synced may be a newer version of any of
    // the link's files, so nothing is taken off until every one is known.
    if (attached.some((o) => o.fileId === null)) return changed
    const attachedStacks = new Set(attached.map(stackOf))
    for (const file of files) {
      if (file.state === 'shared' && (file.name === null || !attachedStacks.has(stackOf(file)))) {
        await ops.deleteShareLinkFile(db, publicKey, file.fileId)
        changed = true
      }
    }
    return changed
  }

  /**
   * Attaches a version to a link with the metadata recipients see. Only this
   * step needs the full object, whose slabs open it as a pinned object, so
   * the checks before it read object refs.
   */
  async function attach(
    sdk: SdkAdapter,
    indexerURL: string,
    key: SharingKeyRef,
    row: FileRecordRow,
  ): Promise<void> {
    const object = (await ops.queryObjectsForFile(db, row.id)).find(
      (o) => o.indexerURL === indexerURL,
    )
    if (!object) throw new Error(`File ${row.id} has no uploaded object`)
    const pinned = sdk.openPinnedObject(sdk.appKey(), object)
    pinned.updateMetadata(sharedMetadata(row))
    await sdk.shareObject(key, pinned)
    await ops.upsertShareLinkObject(db, key.publicKey, object.id, row.updatedAt)
  }

  async function uploadedRef(indexerURL: string, fileId: string) {
    return (await ops.queryObjectRefsForFile(db, fileId)).find((o) => o.indexerURL === indexerURL)
  }

  async function unshare(sdk: SdkAdapter, key: SharingKeyRef, objectId: string): Promise<void> {
    try {
      await sdk.unshareObject(key, objectId)
    } catch (e) {
      if (!isGoneError(e)) throw e
    }
    await ops.deleteShareLinkObject(db, key.publicKey, objectId)
  }

  /**
   * A snapshot file stays on the version row it was shared as, attached with
   * that version's metadata once it is uploaded and again after a restore.
   * `onLink` holds the version row every file on the link names, and is kept
   * current as rows move. Returns whether anything changed.
   */
  async function syncSnapshotFile(
    sdk: SdkAdapter,
    indexerURL: string,
    key: SharingKeyRef,
    file: ops.ShareLinkFileStack,
    inStack: ops.ShareLinkObjectFile[],
    current: FileRecordRow,
    onLink: Set<string>,
  ): Promise<boolean> {
    let row = await ops.queryFileById(db, file.fileId)
    let ref = row ? await uploadedRef(indexerURL, row.id) : undefined
    // The uploader skips a version that a newer one replaced before it was
    // uploaded, so that version never gets an object. The link takes the
    // version that replaced it rather than waiting on it for good.
    if (!ref && file.state === 'pending' && current.id !== file.fileId) {
      // Another file on the link already names that version, after a rename
      // merged the two stacks. Moving this row onto it would collide on the
      // table's key and fail every pass, so this row goes instead.
      if (onLink.has(current.id)) {
        await ops.deleteShareLinkFile(db, key.publicKey, file.fileId)
        onLink.delete(file.fileId)
        return true
      }
      row = current
      ref = await uploadedRef(indexerURL, current.id)
    }
    if (!row || !ref) {
      if (file.state === 'pending') return false
      await ops.updateShareLinkFile(db, key.publicKey, file.fileId, {
        fileId: file.fileId,
        state: 'pending',
      })
      return true
    }
    const objectId = ref.id
    const isAttached = inStack.some((a) => a.objectId === objectId)
    if (isAttached && file.state === 'shared') return false
    if (!isAttached) await attach(sdk, indexerURL, key, row)
    await ops.updateShareLinkFile(db, key.publicKey, file.fileId, {
      fileId: row.id,
      state: 'shared',
    })
    onLink.delete(file.fileId)
    onLink.add(row.id)
    return true
  }

  /**
   * Brings each of a link's files in line with what the link shows: the
   * current version for a `latest` link, the shared version for a `snapshot`,
   * and nothing while every version is trashed. Returns whether anything
   * changed.
   */
  async function syncLink(
    sdk: SdkAdapter,
    indexerURL: string,
    key: SharingKeyRef,
    mode: ShareLinkMode,
  ): Promise<boolean> {
    let changed = false
    const files = await ops.queryShareLinkFileStacks(db, key.publicKey)
    const attached = await ops.queryShareLinkObjectFiles(db, key.publicKey, indexerURL)
    // Two files on a link merge into one stack when a rename or move gives
    // them the same name and folder. Moving both rows onto the one current
    // version would collide on the table's key and fail every later pass, so
    // a latest link keeps the first row of each stack and drops the rest
    // before any row moves.
    const rows: ops.ShareLinkFileStack[] = []
    const stacks = new Set<string>()
    for (const file of files) {
      const live = file.name !== null && file.deletedAt === null
      if (mode === 'latest' && live && stacks.has(stackOf(file))) {
        await ops.deleteShareLinkFile(db, key.publicKey, file.fileId)
        changed = true
        continue
      }
      if (live) stacks.add(stackOf(file))
      rows.push(file)
    }
    const attachedByStack = new Map<string, ops.ShareLinkObjectFile[]>()
    for (const object of attached) {
      if (object.fileId === null) continue
      const stack = stackOf(object)
      const group = attachedByStack.get(stack)
      if (group) group.push(object)
      else attachedByStack.set(stack, [object])
    }
    const onLink = new Set(rows.map((file) => file.fileId))
    for (const file of rows) {
      // A deleted file's objects are deleted from the indexer with it, which
      // detaches them from every key.
      if (file.name === null || file.deletedAt !== null) {
        await ops.deleteShareLinkFile(db, key.publicKey, file.fileId)
        onLink.delete(file.fileId)
        changed = true
        continue
      }
      const inStack = attachedByStack.get(stackOf(file)) ?? []
      const current = await ops.queryCurrentFileVersion(db, file.name, file.directoryId)
      if (!current) {
        for (const object of inStack) await unshare(sdk, key, object.objectId)
        if (inStack.length > 0) changed = true
        if (file.state !== 'trashed') {
          await ops.updateShareLinkFile(db, key.publicKey, file.fileId, {
            fileId: file.fileId,
            state: 'trashed',
          })
          changed = true
        }
        continue
      }
      if (mode === 'snapshot') {
        if (await syncSnapshotFile(sdk, indexerURL, key, file, inStack, current, onLink)) {
          changed = true
        }
        continue
      }
      const ref = await uploadedRef(indexerURL, current.id)
      // Not uploaded yet. Whatever version is attached stays until this one is.
      if (!ref) {
        if (file.state !== 'pending') {
          await ops.updateShareLinkFile(db, key.publicKey, file.fileId, {
            fileId: file.fileId,
            state: 'pending',
          })
          changed = true
        }
        continue
      }
      const attachedNow = inStack.find((a) => a.objectId === ref.id)
      // Attached again only for metadata newer than what is attached, so a
      // device that has not synced a rename yet never puts the old name back
      // over the one another device attached.
      if (
        !attachedNow ||
        attachedNow.sharedUpdatedAt === null ||
        current.updatedAt > attachedNow.sharedUpdatedAt
      ) {
        await attach(sdk, indexerURL, key, current)
        changed = true
      }
      // After the attach, so the link never shows the file missing in between.
      for (const replaced of inStack) {
        if (replaced.objectId === ref.id) continue
        await unshare(sdk, key, replaced.objectId)
        changed = true
      }
      if (file.fileId !== current.id || file.state !== 'shared') {
        await ops.updateShareLinkFile(db, key.publicKey, file.fileId, {
          fileId: current.id,
          state: 'shared',
        })
        changed = true
      }
    }
    return changed
  }

  async function readLink(link: ops.ShareLinkRow): Promise<ShareLink> {
    const files: ShareLinkFile[] = []
    for (const file of await ops.queryShareLinkFileStacks(db, link.publicKey)) {
      // No name is a row whose file this device no longer has.
      if (file.name === null) continue
      // A snapshot shows the version its row names. A latest link shows the
      // stack's current version, or the row itself while every version is
      // trashed.
      const current =
        link.mode === 'latest'
          ? await ops.queryCurrentFileVersion(db, file.name, file.directoryId)
          : null
      const row = current ?? (await ops.queryFileById(db, file.fileId))
      if (!row) continue
      const folder = file.directoryId
        ? ((await ops.queryDirectoryById(db, file.directoryId))?.path ?? null)
        : null
      files.push({ fileId: row.id, name: row.name, size: row.size, folder, state: file.state })
    }
    return {
      publicKey: link.publicKey,
      url: SHARE_LINK_URL_PREFIX + link.seed,
      createdAt: link.createdAt,
      expiresAt: link.expiresAt,
      mode: link.mode,
      files,
    }
  }

  /**
   * The link's row, listing the account's keys first when this device has
   * none for it, as for a link made on another device since the last listing.
   * Null means the key is revoked or expired.
   */
  async function findLink(
    sdk: SdkAdapter,
    indexerURL: string,
    publicKey: string,
  ): Promise<ops.ShareLinkRow | null> {
    const link = await ops.queryShareLink(db, publicKey)
    if (link) return link
    await refresh(sdk, indexerURL)
    return ops.queryShareLink(db, publicKey)
  }

  async function requireLink(
    sdk: SdkAdapter,
    indexerURL: string,
    publicKey: string,
  ): Promise<ops.ShareLinkRow> {
    const link = await findLink(sdk, indexerURL, publicKey)
    if (!link) throw new Error('This link has expired or was revoked')
    return link
  }

  async function runSyncPass(opts: { refresh?: boolean }): Promise<void> {
    const sdk = deps.requireSdk()
    const indexerURL = await deps.getIndexerURL()
    if (opts.refresh || Date.now() - refreshedAt >= SHARE_LINKS_REFRESH_INTERVAL) {
      await refresh(sdk, indexerURL)
    }
    let changed = false
    const now = Date.now()
    for (const link of await ops.queryShareLinks(db, indexerURL)) {
      // The indexer answers not found for an expired key, so every change to
      // it would fail until the next listing drops it.
      if (link.expiresAt !== null && link.expiresAt <= now) continue
      try {
        if (await syncLink(sdk, indexerURL, keyOf(link), link.mode)) {
          changed = true
        }
      } catch (e) {
        // One link failing, such as one revoked on another device since the
        // last listing, must not hold up the others.
        logger.warn('shareLinks', 'sync_link_failed', {
          publicKey: link.publicKey,
          error: e as Error,
        })
      }
    }
    if (changed) deps.invalidate()
  }

  return {
    createLink: (fileIds, { expiresAt, mode }) =>
      exclusive(async () => {
        if (expiresAt !== null && expiresAt <= Date.now()) {
          throw new Error('A link has to expire in the future')
        }
        const sdk = deps.requireSdk()
        const indexerURL = await deps.getIndexerURL()
        const files = await distinctFiles(fileIds)
        if (files.length === 0) throw new Error('None of these files can be shared')
        const key = await sdk.createSharingKey(
          DESCRIPTIONS[mode],
          expiresAt === null ? undefined : new Date(expiresAt),
        )
        const link = {
          publicKey: key.publicKey,
          seed: uint8ToHex(key.seed),
          indexerURL,
          createdAt: Date.now(),
          expiresAt,
          mode,
        }
        await db.withTransactionAsync(async (tx) => {
          await ops.insertShareLink(tx, link)
          for (const fileId of files) {
            await ops.insertShareLinkFile(tx, key.publicKey, fileId, 'pending')
          }
        })
        // Attached now rather than on the next pass, so the link opens on the
        // files already uploaded as soon as it is shown. The key and its rows
        // exist by now and the background pass attaches whatever this misses,
        // so a failure here returns the link with its files pending instead of
        // rejecting, which would have the user make a second link.
        try {
          await syncLink(sdk, indexerURL, key, mode)
        } catch (e) {
          logger.warn('shareLinks', 'create_attach_failed', {
            publicKey: key.publicKey,
            error: e as Error,
          })
        }
        deps.invalidate()
        return readLink(link)
      }),

    async links() {
      const indexerURL = await deps.getIndexerURL()
      const now = Date.now()
      const rows = await ops.queryShareLinks(db, indexerURL)
      return Promise.all(
        rows.filter((l) => l.expiresAt === null || l.expiresAt > now).map(readLink),
      )
    },

    addLinkFiles: (publicKey, fileIds) =>
      exclusive(async () => {
        const sdk = deps.requireSdk()
        const indexerURL = await deps.getIndexerURL()
        const link = await requireLink(sdk, indexerURL, publicKey)
        const existing = await ops.queryShareLinkFileStacks(db, publicKey)
        const taken = new Set(existing.filter((f) => f.name !== null).map(stackOf))
        const added = await distinctFiles(fileIds, taken)
        await db.withTransactionAsync(async (tx) => {
          for (const fileId of added) {
            await ops.insertShareLinkFile(tx, publicKey, fileId, 'pending')
          }
        })
        await syncLink(sdk, indexerURL, keyOf(link), link.mode)
        deps.invalidate()
      }),

    removeLinkFiles: (publicKey, fileIds) =>
      exclusive(async () => {
        const sdk = deps.requireSdk()
        const indexerURL = await deps.getIndexerURL()
        const key = keyOf(await requireLink(sdk, indexerURL, publicKey))
        const stacks = new Set<string>()
        for (const fileId of fileIds) {
          const stack = await ops.queryFileStackKey(db, fileId)
          if (stack) stacks.add(stackOf(stack))
        }
        for (const object of await ops.queryShareLinkObjectFiles(db, publicKey, indexerURL)) {
          if (object.fileId !== null && stacks.has(stackOf(object))) {
            await unshare(sdk, key, object.objectId)
          }
        }
        for (const file of await ops.queryShareLinkFileStacks(db, publicKey)) {
          if (file.name !== null && stacks.has(stackOf(file))) {
            await ops.deleteShareLinkFile(db, publicKey, file.fileId)
          }
        }
        deps.invalidate()
      }),

    revokeLink: (publicKey) =>
      exclusive(async () => {
        const sdk = deps.requireSdk()
        const indexerURL = await deps.getIndexerURL()
        // No row after listing the account's keys means it is already
        // revoked or expired.
        const link = await findLink(sdk, indexerURL, publicKey)
        if (link) {
          try {
            await sdk.revokeSharingKey(keyOf(link))
          } catch (e) {
            if (!isGoneError(e)) throw e
          }
        }
        await ops.deleteShareLink(db, publicKey)
        deps.invalidate()
      }),

    syncLinks: (opts = {}) => {
      const refreshing = opts.refresh === true
      if (waitingPass && (waitingPass.refresh || !refreshing)) return waitingPass.done
      const pass: { refresh: boolean; done: Promise<void> } = {
        refresh: refreshing,
        done: exclusive(async () => {
          // Running now, so a caller from here on waits for a pass of its own,
          // which sees whatever changed while this one runs.
          if (waitingPass === pass) waitingPass = null
          await runSyncPass(opts)
        }),
      }
      waitingPass = pass
      return pass.done
    },
  }
}
