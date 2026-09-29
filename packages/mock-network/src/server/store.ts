/**
 * The mock indexer's state, kept in SQLite with object bytes in files beside it.
 * On disk rather than in memory so the network outlives any app process: a
 * device can be killed and relaunched mid-scenario and find the objects it
 * uploaded, and a test can open the database to inspect it.
 *
 * Follows indexd's object API. A committed upload creates objects that stay
 * out of the event stream until pinned. Each object has one event row, and a
 * change resets it to unpublished, which takes it out of the stream until the
 * publisher runs. The publisher stamps every unpublished event with the current
 * whole second, at most one batch per second, and the stream orders by
 * (position, id). So a change reaches other devices up to a second later, many
 * events share a position, and a device's cursor can sit in the middle of a
 * tie, all as against a real indexer. Every timestamp comes from this process's
 * clock.
 *
 * A packed upload puts many files in shared slabs, and indexd deletes an
 * object by unpinning only the slabs no other object of the account still
 * uses. A pin is an insert-or-update that succeeds while every slab of the
 * object is pinned. So an object deleted while another object from its upload
 * is live comes back when any device pins or edits it, which is how a delete
 * and a peer's metadata update race. The mock treats an upload's objects as
 * sharing all its slabs, and keeps a deleted object's bytes while a sibling
 * lives.
 */
import { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import { mkdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { decodeFileMetadata } from '@siastorage/core/encoding/fileMetadata'
import type { InspectedEvent, InspectedObject, RequestRecord, SdkOp } from '../protocol'

export type ObjectRow = {
  id: string
  metadata: Uint8Array
  size: number
  created_at: number
  updated_at: number
  pinned: number
  uploaded_by: string | null
  content_hash: string | null
  /** The upload whose slabs hold the object, which an injected object has to itself. */
  upload_id: string
}

type EventRow = { id: string; deleted: number; position: number | null }

const SCHEMA = `
CREATE TABLE IF NOT EXISTS objects (
  id TEXT PRIMARY KEY,
  metadata BLOB NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  -- 0 until the uploading device pins it. Unpinned objects are not in the stream.
  pinned INTEGER NOT NULL DEFAULT 0,
  uploaded_by TEXT,
  -- sha256 of the bytes, so a test can find the same content uploaded twice.
  content_hash TEXT,
  -- The upload whose slabs hold the object. Objects of one upload share them.
  upload_id TEXT NOT NULL
);
-- Objects deleted while another object of their upload still holds the shared
-- slabs, with their bytes still on disk, so a pin can bring them back.
CREATE TABLE IF NOT EXISTS deleted_objects (
  id TEXT PRIMARY KEY,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  uploaded_by TEXT,
  content_hash TEXT,
  upload_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  deleted INTEGER NOT NULL,
  -- Stream position in ms, always a whole second. NULL until the publisher stamps it.
  position INTEGER
);
CREATE INDEX IF NOT EXISTS events_order ON events (position, id);
CREATE TABLE IF NOT EXISTS blobs (
  id TEXT PRIMARY KEY,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  device TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY,
  device TEXT NOT NULL,
  blob_ids TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS requests (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  device TEXT NOT NULL,
  op TEXT NOT NULL,
  status INTEGER NOT NULL,
  detail TEXT
);
`

export class NetworkStore {
  readonly db: Database
  private readonly blobDir: string
  private lastNow = 0
  private lastPublishedSecond = 0

  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true })
    this.blobDir = join(dir, 'blobs')
    mkdirSync(this.blobDir, { recursive: true })
    this.db = new Database(join(dir, 'network.db'), { create: true })
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec(SCHEMA)
    // A server restarted on the same state within the second of its last
    // publish would otherwise publish that second again.
    this.lastPublishedSecond =
      this.db.query<{ p: number | null }, []>('SELECT max(position) AS p FROM events').get()?.p ?? 0
  }

  /**
   * Strictly increasing milliseconds for the objects' created and updated
   * times, so two changes to one object never carry the same time. The event
   * stream orders by its own whole-second positions, not by these.
   */
  now(): number {
    this.lastNow = Math.max(Date.now(), this.lastNow + 1)
    return this.lastNow
  }

  nextId(prefix: string): string {
    const row = this.db
      .query<{ value: number }, [string]>(
        `INSERT INTO counters (name, value) VALUES (?1, 1)
         ON CONFLICT(name) DO UPDATE SET value = value + 1 RETURNING value`,
      )
      .get(prefix)
    return `${prefix}-${row?.value}`
  }

  blobPath(blobId: string): string {
    return join(this.blobDir, blobId)
  }

  async putBlob(device: string, bytes: Uint8Array): Promise<{ blobId: string; size: number }> {
    const blobId = this.nextId('blob')
    await Bun.write(this.blobPath(blobId), bytes)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    this.db
      .query('INSERT INTO blobs (id, size, sha256, device) VALUES (?1, ?2, ?3, ?4)')
      .run(blobId, bytes.length, sha256, device)
    return { blobId, size: bytes.length }
  }

  createUpload(device: string, blobIds: string[]): { uploadId: string; bytes: number } {
    const uploadId = this.nextId('upload')
    this.db
      .query('INSERT INTO uploads (id, device, blob_ids) VALUES (?1, ?2, ?3)')
      .run(uploadId, device, JSON.stringify(blobIds))
    let bytes = 0
    for (const id of blobIds) bytes += this.blob(id)?.size ?? 0
    return { uploadId, bytes }
  }

  cancelUpload(uploadId: string): void {
    this.db.query('DELETE FROM uploads WHERE id = ?1').run(uploadId)
  }

  /** Turns each blob of the upload into an object, in the order they were added. */
  commitUpload(uploadId: string): ObjectRow[] {
    const upload = this.db
      .query<{ device: string; blob_ids: string }, [string]>(
        'SELECT device, blob_ids FROM uploads WHERE id = ?1',
      )
      .get(uploadId)
    if (!upload) throw new NotFound(`Upload not found: ${uploadId}`)
    const rows: ObjectRow[] = []
    this.db.transaction(() => {
      for (const blobId of JSON.parse(upload.blob_ids) as string[]) {
        const blob = this.blob(blobId)
        if (!blob) throw new NotFound(`Blob not found: ${blobId}`)
        const id = this.nextId('obj')
        const at = this.now()
        this.db
          .query(
            `INSERT INTO objects (id, metadata, size, created_at, updated_at, pinned, uploaded_by, content_hash, upload_id)
             VALUES (?1, ?2, ?3, ?4, ?4, 0, ?5, ?6, ?7)`,
          )
          .run(id, new Uint8Array(0), blob.size, at, upload.device, blob.sha256, uploadId)
        this.linkBlob(blobId, id)
        rows.push(this.object(id) as ObjectRow)
      }
      this.db.query('DELETE FROM uploads WHERE id = ?1').run(uploadId)
    })()
    return rows
  }

  private linkBlob(blobId: string, objectId: string): void {
    renameSync(this.blobPath(blobId), this.dataPath(objectId))
    this.db.query('DELETE FROM blobs WHERE id = ?1').run(blobId)
  }

  dataPath(objectId: string): string {
    return join(this.blobDir, `object-${objectId}`)
  }

  private blob(id: string): { size: number; sha256: string } | null {
    return this.db
      .query<{ size: number; sha256: string }, [string]>(
        'SELECT size, sha256 FROM blobs WHERE id = ?1',
      )
      .get(id)
  }

  object(id: string): ObjectRow | null {
    return this.db.query<ObjectRow, [string]>('SELECT * FROM objects WHERE id = ?1').get(id)
  }

  /**
   * Pins an uploaded object with the metadata on the uploader's handle, which
   * is also how indexd applies a metadata update. A deleted object comes back
   * while its upload's slabs are still pinned, and fails once they are not.
   * An empty object has no slab to pin.
   */
  pin(id: string, metadata: Uint8Array): ObjectRow {
    const row = this.object(id) ?? this.restore(id)
    if (row.size === 0) throw new BadRequest('object must have at least one slab')
    this.db
      .query('UPDATE objects SET pinned = 1, metadata = ?2, updated_at = ?3 WHERE id = ?1')
      .run(id, metadata, this.now())
    this.unpublish(id, false)
    return this.object(id) as ObjectRow
  }

  updateMetadata(id: string, metadata: Uint8Array): ObjectRow {
    const row = this.object(id)
    if (row && !row.pinned) throw new BadRequest('object contains unpinned slab')
    return this.pin(id, metadata)
  }

  delete(id: string): void {
    const row = this.object(id)
    if (!row) throw new NotFound('object not found')
    this.db.transaction(() => {
      this.db.query('DELETE FROM objects WHERE id = ?1').run(id)
      this.unpublish(id, true)
      if (this.uploadLive(row.upload_id)) {
        this.db
          .query(
            `INSERT INTO deleted_objects (id, size, created_at, uploaded_by, content_hash, upload_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
          )
          .run(id, row.size, row.created_at, row.uploaded_by, row.content_hash, row.upload_id)
        return
      }
      // The last live object of the upload is gone, so indexd unpins its
      // slabs, and every object deleted from it earlier is gone for good too.
      const gone = this.db
        .query<{ id: string }, [string]>('SELECT id FROM deleted_objects WHERE upload_id = ?1')
        .all(row.upload_id)
      this.db.query('DELETE FROM deleted_objects WHERE upload_id = ?1').run(row.upload_id)
      for (const objectId of [id, ...gone.map((g) => g.id)]) {
        rmSync(this.dataPath(objectId), { force: true })
      }
    })()
  }

  /** Whether any object of the upload is live, which keeps its slabs pinned. */
  private uploadLive(uploadId: string): boolean {
    return (
      this.db
        .query<{ n: number }, [string]>('SELECT count(*) AS n FROM objects WHERE upload_id = ?1')
        .get(uploadId)?.n !== 0
    )
  }

  /** Brings back a deleted object whose upload's slabs are still pinned, as indexd's pin does. */
  private restore(id: string): ObjectRow {
    const dead = this.db
      .query<Omit<ObjectRow, 'metadata' | 'updated_at' | 'pinned'>, [string]>(
        'SELECT * FROM deleted_objects WHERE id = ?1',
      )
      .get(id)
    if (!dead) throw new BadRequest('object contains unpinned slab')
    this.db.transaction(() => {
      this.db
        .query(
          `INSERT INTO objects (id, metadata, size, created_at, updated_at, pinned, uploaded_by, content_hash, upload_id)
           VALUES (?1, ?2, ?3, ?4, ?4, 0, ?5, ?6, ?7)`,
        )
        .run(
          id,
          new Uint8Array(0),
          dead.size,
          dead.created_at,
          dead.uploaded_by,
          dead.content_hash,
          dead.upload_id,
        )
      this.db.query('DELETE FROM deleted_objects WHERE id = ?1').run(id)
    })()
    return this.object(id) as ObjectRow
  }

  /** Stands up an object another device already published: stored, pinned, in the stream. */
  async inject(input: { metadata: Uint8Array; data: Uint8Array }): Promise<ObjectRow> {
    const id = this.nextId('obj')
    const at = this.now()
    await Bun.write(this.dataPath(id), input.data)
    const hash = createHash('sha256').update(input.data).digest('hex')
    this.db
      .query(
        `INSERT INTO objects (id, metadata, size, created_at, updated_at, pinned, uploaded_by, content_hash, upload_id)
         VALUES (?1, ?2, ?3, ?4, ?4, 1, 'control', ?5, ?1)`,
      )
      .run(id, input.metadata, input.data.length, at, hash)
    this.unpublish(id, false)
    return this.object(id) as ObjectRow
  }

  /** Takes the object's event out of the stream until the next publish. */
  private unpublish(id: string, deleted: boolean): void {
    this.db
      .query(
        `INSERT INTO events (id, deleted, position) VALUES (?1, ?2, NULL)
         ON CONFLICT(id) DO UPDATE SET deleted = ?2, position = NULL`,
      )
      .run(id, deleted ? 1 : 0)
  }

  /**
   * Stamps every unpublished event with the current whole second. Runs at most
   * once per second: a second batch in the same second could put an event
   * behind a cursor that already passed that position with a larger id, and
   * the device holding that cursor would never see it.
   */
  publish(): number {
    const second = Math.floor(Date.now() / 1000) * 1000
    if (second <= this.lastPublishedSecond) return 0
    const { changes } = this.db
      .query('UPDATE events SET position = ?1 WHERE position IS NULL')
      .run(second)
    if (changes > 0) this.lastPublishedSecond = second
    return changes
  }

  /** Published events strictly after the cursor, in (position, id) order. */
  events(
    after: { ms: number; id: string } | undefined,
    limit: number,
  ): Array<{ event: EventRow & { position: number }; object: ObjectRow | null }> {
    const rows = after
      ? this.db
          .query<EventRow, [number, string, number]>(
            `SELECT * FROM events WHERE position IS NOT NULL
               AND (position > ?1 OR (position = ?1 AND id > ?2))
             ORDER BY position, id LIMIT ?3`,
          )
          .all(after.ms, after.id, limit)
      : this.db
          .query<EventRow, [number]>(
            'SELECT * FROM events WHERE position IS NOT NULL ORDER BY position, id LIMIT ?1',
          )
          .all(limit)
    return rows.map((event) => ({
      event: event as EventRow & { position: number },
      object: event.deleted ? null : this.object(event.id),
    }))
  }

  pinnedTotals(): { bytes: number; count: number } {
    const row = this.db
      .query<{ bytes: number | null; count: number }, []>(
        'SELECT sum(size) AS bytes, count(*) AS count FROM objects WHERE pinned = 1',
      )
      .get()
    return { bytes: row?.bytes ?? 0, count: row?.count ?? 0 }
  }

  logRequest(device: string, op: SdkOp, status: number, detail: string | null): void {
    this.db
      .query('INSERT INTO requests (at, device, op, status, detail) VALUES (?1, ?2, ?3, ?4, ?5)')
      .run(Date.now(), device, op, status, detail)
  }

  requests(filter: { device?: string; op?: string; sinceSeq?: number }): RequestRecord[] {
    return this.db
      .query<RequestRecord, [string | null, string | null, number]>(
        `SELECT seq, at, device, op, status, detail FROM requests
         WHERE (?1 IS NULL OR device = ?1) AND (?2 IS NULL OR op = ?2) AND seq > ?3
         ORDER BY seq`,
      )
      .all(filter.device ?? null, filter.op ?? null, filter.sinceSeq ?? 0)
  }

  devices(): string[] {
    return this.db
      .query<{ device: string }, []>('SELECT DISTINCT device FROM requests ORDER BY device')
      .all()
      .map((r) => r.device)
  }

  inspectObjects(includeUnpinned: boolean): InspectedObject[] {
    const rows = this.db
      .query<ObjectRow, [number]>(
        'SELECT * FROM objects WHERE pinned = 1 OR ?1 = 1 ORDER BY created_at, id',
      )
      .all(includeUnpinned ? 1 : 0)
    return rows.map(inspect)
  }

  /** Every event, published or not. An unpublished one has a null position. */
  inspectEvents(): InspectedEvent[] {
    return this.db
      .query<EventRow, []>('SELECT * FROM events ORDER BY position IS NULL, position, id')
      .all()
      .map((e) => ({ id: e.id, deleted: e.deleted === 1, position: e.position }))
  }

  deletedEventCount(): number {
    return (
      this.db.query<{ n: number }, []>('SELECT count(*) AS n FROM events WHERE deleted = 1').get()
        ?.n ?? 0
    )
  }

  close(): void {
    this.db.close()
  }
}

export class NotFound extends Error {}
export class BadRequest extends Error {}

function inspect(row: ObjectRow): InspectedObject {
  let metadata: Record<string, unknown> | null = null
  if (row.metadata.length > 0) {
    try {
      const bytes = new Uint8Array(row.metadata)
      metadata = decodeFileMetadata(bytes.buffer) as unknown as Record<string, unknown>
    } catch {
      metadata = null
    }
  }
  return {
    id: row.id,
    pinned: row.pinned === 1,
    size: row.size,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    uploadedBy: row.uploaded_by,
    contentHash: row.content_hash,
    metadata,
  }
}
