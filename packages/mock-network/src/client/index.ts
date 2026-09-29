/**
 * An SdkAdapter that talks to the mock network over HTTP, so several app
 * processes share one indexer. Uses only fetch, and runs under Bun, Node and
 * React Native alike.
 *
 * Several SDK methods are synchronous and return live handles, which a remote
 * call cannot do. Mock objects carry no real encryption, so a handle here is a
 * plain local value: sealing, reopening and editing metadata happen in this
 * process, and only the calls the real SDK makes over the network become
 * requests.
 */
import type {
  Account,
  AppKeyRef,
  DownloadLikeRef,
  DownloadOptions,
  Host,
  ObjectEvent,
  ObjectsCursor,
  PackedUploadRef,
  PinnedObjectRef,
  SdkAdapter,
  UploadOptions,
} from '@siastorage/core/adapters'
import { SECTOR_SIZE } from '@siastorage/core/config'
import type { LocalObject } from '@siastorage/core/encoding/localObject'
import {
  DEVICE_HEADER,
  PACKED_BYTES_HEADER,
  toHex,
  type WireAccount,
  type WireBlob,
  type WireEvent,
  type WireObject,
  type WireUpload,
} from '../protocol'
import { openLocalPinnedObject, pinnedObjectFromWire } from './pinnedObject'

/**
 * Sends a local file to the network and returns the blob it became. Each
 * platform supplies its own: the phone's uploads by path in native code,
 * because the real SDK never moves upload bytes through JavaScript and a mock
 * that did would add a cost the app does not have.
 */
export type FileSender = (
  path: string,
  blobsUrl: string,
  headers: Record<string, string>,
) => Promise<WireBlob>

export type RemoteSdkOptions = {
  /** Base URL of the mock network, e.g. http://127.0.0.1:4100. */
  url: string
  /** This device's name in the server's request log and fault rules. */
  device: string
  sendFile: FileSender
}

export async function parse(res: Response): Promise<unknown> {
  if (res.status === 204) return undefined
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`)
  return body
}

const MOCK_KEY = new Uint8Array(64)

function mockAppKey(): AppKeyRef {
  return {
    export_: () => MOCK_KEY.slice().buffer,
    publicKey: () => '0'.repeat(64),
    sign: () => new ArrayBuffer(64),
    verifySignature: () => true,
  }
}

export function createRemoteSdk(options: RemoteSdkOptions): SdkAdapter {
  const base = options.url.replace(/\/$/, '')
  const headers = { [DEVICE_HEADER]: options.device }
  const sendFile = options.sendFile

  async function call(path: string, init: RequestInit = {}): Promise<unknown> {
    const res = await fetch(`${base}/sdk${path}`, {
      ...init,
      headers: { ...headers, 'content-type': 'application/json', ...init.headers },
    })
    return parse(res)
  }

  const sdk: SdkAdapter = {
    async objectEvents(cursor: ObjectsCursor | undefined, limit: number): Promise<ObjectEvent[]> {
      const q = new URLSearchParams({ limit: String(limit) })
      if (cursor) {
        q.set('afterMs', String(cursor.after.getTime()))
        q.set('afterId', cursor.id)
      }
      const { events } = (await call(`/events?${q}`)) as { events: WireEvent[] }
      return events.map((e) => ({
        id: e.id,
        deleted: e.deleted,
        updatedAt: new Date(e.updatedAt),
        ...(e.object ? { object: pinnedObjectFromWire(e.object) } : {}),
      }))
    },

    async updateObjectMetadata(object: PinnedObjectRef): Promise<void> {
      await call(`/objects/${encodeURIComponent(object.id())}/metadata`, {
        method: 'PUT',
        body: JSON.stringify({ metadata: toHex(object.metadata()) }),
      })
    },

    async pinObject(object: PinnedObjectRef): Promise<void> {
      await call(`/objects/${encodeURIComponent(object.id())}/pin`, {
        method: 'POST',
        body: JSON.stringify({ metadata: toHex(object.metadata()) }),
      })
    },

    async deleteObject(objectId: string): Promise<void> {
      await call(`/objects/${encodeURIComponent(objectId)}`, { method: 'DELETE' })
    },

    async getPinnedObject(objectId: string): Promise<PinnedObjectRef> {
      return pinnedObjectFromWire(
        (await call(`/objects/${encodeURIComponent(objectId)}`)) as WireObject,
      )
    },

    async download(object: PinnedObjectRef, opts: DownloadOptions): Promise<DownloadLikeRef> {
      const id = encodeURIComponent(object.id())
      const size = Number(object.size())
      const start = Number(opts.offset)
      const end = opts.length === undefined ? size : Math.min(size, start + Number(opts.length))
      let position = start
      let cancelled = false
      let chunkIndex = 0
      return {
        async read(control?: { signal: AbortSignal }): Promise<ArrayBuffer> {
          if (cancelled || control?.signal.aborted || position >= end) return new ArrayBuffer(0)
          const length = Math.min(SECTOR_SIZE, end - position)
          const began = Date.now()
          const res = await fetch(
            `${base}/sdk/objects/${id}/data?offset=${position}&length=${length}`,
            {
              headers,
              signal: control?.signal,
            },
          )
          if (!res.ok) await parse(res)
          const chunk = await res.arrayBuffer()
          position += chunk.byteLength
          opts.shardDownloaded?.progress({
            hostKey: 'mock-host',
            shardSize: BigInt(chunk.byteLength),
            shardIndex: chunkIndex,
            slabIndex: chunkIndex++,
            elapsedMs: BigInt(Date.now() - began),
          })
          return chunk
        },
        async cancel() {
          cancelled = true
        },
      }
    },

    async downloadByObjectId(objectId: string): Promise<ArrayBuffer> {
      const res = await fetch(`${base}/sdk/objects/${encodeURIComponent(objectId)}/data`, {
        headers,
      })
      if (!res.ok) await parse(res)
      return res.arrayBuffer()
    },

    async uploadPacked(opts: UploadOptions): Promise<PackedUploadRef> {
      return new RemotePacker(call, sendFile, `${base}/sdk/blobs`, headers, opts)
    },

    async sharedObject(url: string): Promise<PinnedObjectRef> {
      const res = await fetch(url, { headers })
      return pinnedObjectFromWire((await parse(res)) as WireObject)
    },

    shareObject(object: PinnedObjectRef): string {
      return `${base}/sdk/shared/${encodeURIComponent(object.id())}`
    },

    openAppKey(): AppKeyRef {
      return mockAppKey()
    },

    openPinnedObject(_appKey: AppKeyRef, object: LocalObject): PinnedObjectRef {
      return openLocalPinnedObject(object)
    },

    appKey(): AppKeyRef {
      return mockAppKey()
    },

    async hosts(): Promise<Host[]> {
      return []
    },

    async account(): Promise<Account> {
      const a = (await call('/account')) as WireAccount
      return {
        accountKey: '0'.repeat(64),
        maxPinnedData: BigInt(a.maxPinnedData),
        remainingStorage: BigInt(a.maxPinnedData) - BigInt(a.pinnedData),
        pinnedData: BigInt(a.pinnedData),
        pinnedSize: BigInt(a.pinnedSize),
        app: { id: 'mock-app', description: 'Mock network' },
        lastUsed: new Date(),
      }
    },

    async pruneSlabs(): Promise<void> {
      await call('/prune', { method: 'POST' })
    },
  }
  return sdk
}

/**
 * Collects files into blobs on the server as they are added, and turns them
 * into objects at finalize. Between the two it reports shard progress at the
 * pace the server sets from its upload rate, so the uploader's speed and
 * progress accounting sees the same stream of events it gets from the real SDK.
 */
class RemotePacker implements PackedUploadRef {
  private blobs: WireBlob[] = []
  private total = 0n
  private queue: Promise<void> = Promise.resolve()
  /** Set by finalize. After it or a cancel, the real SDK refuses adds and finalize with `upload closed`. */
  private closed = false
  private cancelled = false
  private readonly slabBytes: bigint

  constructor(
    private readonly call: (path: string, init?: RequestInit) => Promise<unknown>,
    private readonly sendFile: FileSender,
    private readonly blobsUrl: string,
    private readonly headers: Record<string, string>,
    private readonly options: UploadOptions,
  ) {
    this.slabBytes = BigInt(SECTOR_SIZE) * BigInt(options.dataShards)
  }

  /**
   * Adds run one at a time in call order, as they do in the real SDK. The
   * uploader fires several adds at once and matches finalize's objects to
   * files by position, so an add that finished out of order would give a file
   * another file's object.
   */
  addPath(path: string): Promise<bigint> {
    const run = this.queue.then(() => this.add(path))
    this.queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private async add(path: string): Promise<bigint> {
    if (this.closed || this.cancelled) throw new Error('upload closed')
    const blob = await this.sendFile(path, this.blobsUrl, {
      ...this.headers,
      [PACKED_BYTES_HEADER]: String(this.total),
    })
    // The real SDK drops an add that a cancel interrupts.
    if (this.cancelled) throw new Error('upload closed')
    this.blobs.push(blob)
    const size = BigInt(blob.size)
    this.total += size
    return size
  }

  cancel(): void {
    this.cancelled = true
    this.blobs = []
    this.total = 0n
  }

  length(): bigint {
    return this.total
  }

  remaining(): bigint {
    return this.slabBytes - (this.total % this.slabBytes)
  }

  slabs(): bigint {
    return this.total === 0n ? 0n : (this.total + this.slabBytes - 1n) / this.slabBytes
  }

  async finalize(): Promise<PinnedObjectRef[]> {
    if (this.closed || this.cancelled) throw new Error('upload closed')
    this.closed = true
    const { uploadId, shardDelayMs } = (await this.call('/uploads', {
      method: 'POST',
      body: JSON.stringify({ blobIds: this.blobs.map((b) => b.blobId) }),
    })) as WireUpload

    const totalShards = this.options.dataShards + this.options.parityShards
    const slabCount = Number(this.slabs())
    for (let slab = 0; slab < slabCount; slab++) {
      for (let shard = 0; shard < totalShards; shard++) {
        if (this.cancelled) {
          await this.call(`/uploads/${uploadId}`, { method: 'DELETE' })
          throw new Error('upload closed')
        }
        this.options.shardUploaded?.progress({
          hostKey: `mock-host-${slab}-${shard}`,
          shardSize: BigInt(SECTOR_SIZE),
          shardIndex: shard,
          slabIndex: slab,
          elapsedMs: BigInt(shardDelayMs),
        })
        if (shardDelayMs > 0) await new Promise((r) => setTimeout(r, shardDelayMs))
      }
    }

    const { objects } = (await this.call(`/uploads/${uploadId}/commit`, {
      method: 'POST',
    })) as { objects: WireObject[] }
    this.blobs = []
    this.total = 0n
    return objects.map(pinnedObjectFromWire)
  }
}
