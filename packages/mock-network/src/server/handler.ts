/**
 * Routes for the mock network. `/sdk/*` is what each app's SDK client calls,
 * and every request there passes through the conditions and faults a test has
 * set. `/control/*` is for tests and agents: seed and inspect the indexer, and
 * change conditions. Control requests are never delayed or failed.
 */
import { SECTOR_SIZE, UPLOAD_DATA_SHARDS, UPLOAD_PARITY_SHARDS } from '@siastorage/core/config'
import { encodeFileMetadata } from '@siastorage/core/encoding/fileMetadata'
import type { FileMetadata } from '@siastorage/core/types'
import {
  type ApprovalMode,
  type AuthSummary,
  type Conditions,
  DEVICE_HEADER,
  type FaultInput,
  PACKED_BYTES_HEADER,
  type FaultRule,
  type HoldRule,
  fromHex,
  SDK_OPS,
  type SdkOp,
  type Summary,
  toHex,
  type WireAccount,
  type WireApproval,
  type WireConnectionRequest,
  type WireEvent,
  type WireObject,
  type WireSharingKey,
} from '../protocol'
import type { Relay } from './relay'
import { BadRequest, Forbidden, NotFound, type NetworkStore, type ObjectRow } from './store'

export type NetworkHandler = {
  fetch(req: Request): Promise<Response>
}

class Fault extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export function createNetworkHandler(store: NetworkStore, relay: Relay): NetworkHandler {
  const conditions: Conditions = { offline: [], latencyMs: 0, uploadBytesPerSec: 0 }
  let faults: FaultRule[] = []
  let faultSeq = 0
  // When each upload may commit. Uploads queue one after another on a single
  // link at the upload rate, so with two at once the second finishes after
  // both have been sent.
  const uploadDeadlines = new Map<string, { device: string; deadline: number }>()

  /** When the link is free of every upload still reserved on it. */
  function latestDeadline(): number {
    let latest = 0
    for (const { deadline } of uploadDeadlines.values()) latest = Math.max(latest, deadline)
    return latest
  }

  let holds: Array<HoldRule & { released: Promise<void>; release: () => void }> = []
  // Approving on arrival is what every device that signs in on its own needs.
  // A test of the sign-in screens switches to manual and settles each request.
  let approvalMode: ApprovalMode = 'auto'

  function takeFault(op: SdkOp, device: string): FaultRule | undefined {
    const rule = faults.find((f) => f.op === op && (!f.device || f.device === device))
    if (!rule) return undefined
    rule.remaining -= 1
    if (rule.remaining <= 0) faults = faults.filter((f) => f !== rule)
    return rule
  }

  async function sdk(
    req: Request,
    device: string,
    op: SdkOp,
    run: () => Promise<Response> | Response,
    opts: { local?: boolean } = {},
  ): Promise<Response> {
    // A local call is one the real SDK serves without the network, so network
    // conditions do not apply to it. A fault still fails it, which stands in
    // for an add failing to read its file.
    if (!opts.local && conditions.latencyMs > 0) await Bun.sleep(conditions.latencyMs)
    let response: Response
    try {
      if (!opts.local && conditions.offline.includes(device)) {
        throw new Fault(503, 'Network unavailable')
      }
      const fault = takeFault(op, device)
      if (fault) throw new Fault(fault.status, fault.message)
      const hold = holds.find((h) => h.op === op && (!h.device || h.device === device))
      if (hold) {
        // A client that disconnects is no longer waiting, so `waiting` counts
        // only calls an app still has open.
        const gone = new Promise<void>((resolve) => {
          if (req.signal.aborted) resolve()
          req.signal.addEventListener('abort', () => resolve(), { once: true })
        })
        hold.waiting += 1
        await Promise.race([hold.released, gone])
        hold.waiting -= 1
        if (req.signal.aborted) throw new Fault(499, 'The client went away while its call was held')
      }
      response = await run()
    } catch (e) {
      response = errorResponse(e)
    }
    const detail = new URL(req.url).pathname.split('/')[3] ?? null
    store.logRequest(device, op, response.status, detail)
    return response
  }

  async function routeSdk(req: Request, parts: string[], url: URL): Promise<Response> {
    const device = req.headers.get(DEVICE_HEADER) ?? 'unknown'
    const [resource, id, action] = parts
    const method = req.method

    if (resource === 'events' && method === 'GET') {
      return sdk(req, device, 'events', () => {
        const afterMs = url.searchParams.get('afterMs')
        const after = afterMs
          ? { ms: Number(afterMs), id: url.searchParams.get('afterId') ?? '' }
          : undefined
        const limit = Number(url.searchParams.get('limit') ?? '100')
        if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
          throw new BadRequest('limit must be between 1 and 500')
        }
        const events: WireEvent[] = store.events(after, limit).map(({ event, object }) => ({
          id: event.id,
          deleted: event.deleted === 1,
          updatedAt: event.position,
          ...(object ? { object: wire(object) } : {}),
        }))
        return Response.json({ events })
      })
    }

    if (resource === 'objects' && id) {
      if (!action && method === 'GET') {
        return sdk(req, device, 'getObject', () => Response.json(wire(mustGet(id))))
      }
      if (!action && method === 'DELETE') {
        return sdk(req, device, 'delete', () => {
          store.delete(id)
          return new Response(null, { status: 204 })
        })
      }
      if (action === 'metadata' && method === 'PUT') {
        return sdk(req, device, 'updateMetadata', async () => {
          const body = (await req.json()) as { metadata: string }
          return Response.json(wire(store.updateMetadata(id, fromHex(body.metadata))))
        })
      }
      if (action === 'pin' && method === 'POST') {
        return sdk(req, device, 'pin', async () => {
          const body = (await req.json()) as { metadata: string }
          return Response.json(wire(store.pin(id, fromHex(body.metadata))))
        })
      }
      if (action === 'data' && method === 'GET') {
        return sdk(req, device, 'download', () => {
          const row = mustGet(id)
          const offset = Number(url.searchParams.get('offset') ?? '0')
          const lengthParam = url.searchParams.get('length')
          const end = lengthParam ? Math.min(row.size, offset + Number(lengthParam)) : row.size
          return new Response(Bun.file(store.dataPath(id)).slice(offset, end))
        })
      }
    }

    if (resource === 'shared' && id && method === 'GET') {
      return sdk(req, device, 'shared', () => Response.json(wire(mustGet(id))))
    }

    if (resource === 'blobs' && method === 'POST') {
      const bytes = new Uint8Array(await req.arrayBuffer())
      const packed = Number(req.headers.get(PACKED_BYTES_HEADER) ?? '0')
      const slab = SECTOR_SIZE * UPLOAD_DATA_SHARDS
      const fillsSlab = Math.floor((packed + bytes.length) / slab) > Math.floor(packed / slab)
      return sdk(
        req,
        device,
        'blob',
        async () => {
          const { blobId, size } = await store.putBlob(device, bytes)
          return Response.json({ blobId, size: String(size) })
        },
        { local: !fillsSlab },
      )
    }

    if (resource === 'uploads') {
      if (!id && method === 'POST') {
        return sdk(req, device, 'upload', async () => {
          const body = (await req.json()) as { blobIds: string[] }
          // An app finalizes one upload at a time, so one it still holds is
          // from a process that was killed mid-upload and will never commit
          // or cancel it. Its time on the link is handed back, since nothing
          // is sending those bytes.
          for (const [stale, reserved] of uploadDeadlines) {
            if (reserved.device !== device) continue
            uploadDeadlines.delete(stale)
            store.cancelUpload(stale)
          }
          const { uploadId, bytes } = store.createUpload(device, body.blobIds)
          const shards = shardCount(bytes)
          const now = Date.now()
          // With no rate the upload is sent at once. With one, it goes after
          // every upload already reserved, each keeping the pace it was given.
          let deadline = now
          if (conditions.uploadBytesPerSec > 0) {
            const start = Math.max(now, latestDeadline())
            deadline = start + Math.ceil((bytes / conditions.uploadBytesPerSec) * 1000)
          }
          uploadDeadlines.set(uploadId, { device, deadline })
          const shardDelayMs = shards > 0 ? Math.floor((deadline - now) / shards) : 0
          return Response.json({ uploadId, shardDelayMs })
        })
      }
      if (id && action === 'commit' && method === 'POST') {
        return sdk(req, device, 'commit', async () => {
          const wait = (uploadDeadlines.get(id)?.deadline ?? 0) - Date.now()
          if (wait > 0) await Bun.sleep(wait)
          uploadDeadlines.delete(id)
          return Response.json({ objects: store.commitUpload(id).map(wire) })
        })
      }
      if (id && !action && method === 'DELETE') {
        return sdk(req, device, 'cancelUpload', () => {
          uploadDeadlines.delete(id)
          store.cancelUpload(id)
          return new Response(null, { status: 204 })
        })
      }
    }

    if (resource === 'account' && method === 'GET') {
      return sdk(req, device, 'account', () => {
        const { bytes } = store.pinnedTotals()
        const account: WireAccount = {
          pinnedData: String(bytes),
          pinnedSize: String(bytes),
          maxPinnedData: String(1024 ** 4),
        }
        return Response.json(account)
      })
    }

    if (resource === 'auth') {
      if (id === 'requests' && !action && method === 'POST') {
        return sdk(req, device, 'auth', () => {
          const requestId = store.createConnectionRequest(device)
          if (approvalMode === 'auto') store.settleConnectionRequests('approved', requestId)
          const body: WireConnectionRequest = {
            requestId,
            approvalUrl: `${url.origin}/approve/${requestId}`,
          }
          return Response.json(body)
        })
      }
      if (id === 'requests' && action) {
        const verb = parts[3]
        if (!verb && method === 'GET') {
          return sdk(req, device, 'auth', () => {
            const { state, reconnecting } = mustGetRequest(action)
            const body: WireApproval = { state, reconnecting }
            return Response.json(body)
          })
        }
        if (verb === 'matches' && method === 'POST') {
          return sdk(req, device, 'auth', async () => {
            mustBeApproved(action)
            const { appKey } = (await req.json()) as { appKey: string }
            return Response.json({ matches: store.hasAppKey(appKey) })
          })
        }
        if (verb === 'register' && method === 'POST') {
          return sdk(req, device, 'auth', async () => {
            mustBeApproved(action)
            const { appKey } = (await req.json()) as { appKey: string }
            if (!/^[0-9a-f]{64}$/.test(appKey))
              throw new BadRequest('appKey must be 32 bytes of hex')
            store.registerAppKey(appKey, device)
            return new Response(null, { status: 204 })
          })
        }
      }
      if (id === 'connected' && method === 'POST') {
        return sdk(req, device, 'auth', async () => {
          const { appKey } = (await req.json()) as { appKey: string }
          return Response.json({ connected: store.hasAppKey(appKey) })
        })
      }
    }

    if (resource === 'sharing') {
      const page = () => {
        const offset = Number(url.searchParams.get('offset') ?? '0')
        const limit = Number(url.searchParams.get('limit') ?? '100')
        if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
          throw new BadRequest('limit must be between 1 and 500')
        }
        return { offset, limit }
      }
      if (!id && method === 'POST') {
        return sdk(req, device, 'sharing', async () => {
          const body = (await req.json()) as { description: string; expiresAt: number | null }
          const key: WireSharingKey = store.createSharingKey(body.description, body.expiresAt)
          return Response.json(key)
        })
      }
      if (!id && method === 'GET') {
        return sdk(req, device, 'sharing', () => {
          const { offset, limit } = page()
          return Response.json({ keys: store.sharingKeys(offset, limit) })
        })
      }
      if (id && !action && method === 'DELETE') {
        return sdk(req, device, 'sharing', () => {
          store.revokeSharingKey(id)
          return new Response(null, { status: 204 })
        })
      }
      if (id && action === 'objects') {
        const objectId = parts[3]
        if (!objectId && method === 'GET') {
          return sdk(req, device, 'sharing', () => {
            const { offset, limit } = page()
            return Response.json({ objects: store.sharedObjects(id, offset, limit).map(wire) })
          })
        }
        if (objectId && method === 'PUT') {
          return sdk(req, device, 'sharing', async () => {
            const body = (await req.json()) as { metadata: string }
            store.shareObject(id, objectId, fromHex(body.metadata))
            return new Response(null, { status: 204 })
          })
        }
        if (objectId && method === 'DELETE') {
          return sdk(req, device, 'sharing', () => {
            store.unshareObject(id, objectId)
            return new Response(null, { status: 204 })
          })
        }
      }
    }

    if (resource === 'prune' && method === 'POST') {
      return sdk(req, device, 'prune', () => new Response(null, { status: 204 }))
    }

    return Response.json({ error: `No route: ${method} /sdk/${parts.join('/')}` }, { status: 404 })
  }

  function mustGet(id: string): ObjectRow {
    const row = store.object(id)
    if (!row) throw new NotFound(`Object not found: ${id}`)
    return row
  }

  function mustGetRequest(id: string) {
    const request = store.connectionRequest(id)
    if (!request) throw new NotFound(`Connection request not found: ${id}`)
    return request
  }

  /** The SDK allows registering and key checks only once the request is approved. */
  function mustBeApproved(id: string): void {
    const { state } = mustGetRequest(id)
    if (state !== 'approved') throw new Forbidden(`Connection request ${id} is ${state}`)
  }

  async function routeControl(req: Request, parts: string[], url: URL): Promise<Response> {
    const [resource, id, action] = parts
    const method = req.method

    if (resource === 'health') return Response.json({ ok: true, pid: process.pid })

    if (resource === 'summary' && method === 'GET') {
      const totals = store.inspectObjects(true)
      const summary: Summary = {
        objects: totals.length,
        pinned: totals.filter((o) => o.pinned).length,
        deletedEvents: store.deletedEventCount(),
        bytes: store.pinnedTotals().bytes,
        devices: store.devices(),
        conditions,
        faults,
      }
      return Response.json(summary)
    }

    if (resource === 'objects') {
      if (!id && method === 'GET') {
        return Response.json(store.inspectObjects(url.searchParams.get('unpinned') === '1'))
      }
      if (!id && method === 'POST') {
        const body = (await req.json()) as { metadata: FileMetadata; data?: string }
        const data = body.data ? fromHex(body.data) : new Uint8Array(body.metadata.size)
        const metadata = new Uint8Array(encodeFileMetadata(body.metadata))
        const row = await store.inject({ metadata, data })
        return Response.json(wire(row))
      }
    }

    if (resource === 'devices') {
      if (!id && method === 'GET') return Response.json(relay.connected())
      if (id && action === 'call' && method === 'POST') {
        const body = (await req.json()) as { method: string; args?: unknown[]; timeoutMs?: number }
        try {
          const result = await relay.call(id, body.method, body.args ?? [], body.timeoutMs)
          return Response.json({ result: result ?? null })
        } catch (e) {
          return Response.json(
            { error: e instanceof Error ? e.message : String(e) },
            { status: 502 },
          )
        }
      }
    }

    if (resource === 'events' && method === 'GET') return Response.json(store.inspectEvents())

    if (resource === 'shares' && method === 'GET') return Response.json(store.inspectShares())

    if (resource === 'requests' && method === 'GET') {
      return Response.json(
        store.requests({
          device: url.searchParams.get('device') ?? undefined,
          op: url.searchParams.get('op') ?? undefined,
          sinceSeq: Number(url.searchParams.get('since') ?? '0'),
        }),
      )
    }

    if (resource === 'conditions') {
      // One device in or out of the offline list, so two commands at once
      // cannot each write back a list missing the other's change.
      if (id === 'offline' && action && (method === 'PUT' || method === 'DELETE')) {
        const others = conditions.offline.filter((d) => d !== action)
        conditions.offline = method === 'PUT' ? [...others, action] : others
        return Response.json(conditions)
      }
      if (method === 'GET') return Response.json(conditions)
      if (method === 'PATCH') {
        Object.assign(conditions, (await req.json()) as Partial<Conditions>)
        return Response.json(conditions)
      }
    }

    if (resource === 'auth') {
      if (!id && method === 'GET') {
        const summary: AuthSummary = {
          mode: approvalMode,
          requests: store.connectionRequests(),
          appKeys: store.appKeys(),
        }
        return Response.json(summary)
      }
      if (!id && method === 'PATCH') {
        const { mode } = (await req.json()) as { mode: ApprovalMode }
        if (mode !== 'auto' && mode !== 'manual') {
          throw new BadRequest(`Unknown approval mode ${String(mode)}. One of: auto, manual`)
        }
        approvalMode = mode
        return Response.json({ mode })
      }
      if ((id === 'approve' || id === 'deny') && method === 'POST') {
        const { requestId } = (await req.json().catch(() => ({}))) as { requestId?: string }
        const settled = store.settleConnectionRequests(
          id === 'approve' ? 'approved' : 'denied',
          requestId,
        )
        return Response.json({ settled })
      }
    }

    if (resource === 'holds') {
      if (method === 'GET')
        return Response.json(holds.map(({ op, device, waiting }) => ({ op, device, waiting })))
      if (method === 'POST') {
        const input = (await req.json()) as { op: SdkOp; device?: string }
        if (!SDK_OPS.includes(input.op)) {
          throw new BadRequest(`Unknown op ${input.op}. One of: ${SDK_OPS.join(', ')}`)
        }
        let release!: () => void
        const released = new Promise<void>((resolve) => {
          release = resolve
        })
        holds.push({ op: input.op, device: input.device, waiting: 0, released, release })
        return new Response(null, { status: 204 })
      }
      if (method === 'DELETE') {
        for (const hold of holds) hold.release()
        holds = []
        return new Response(null, { status: 204 })
      }
    }

    if (resource === 'faults') {
      if (method === 'GET') return Response.json(faults)
      if (method === 'POST') {
        const input = (await req.json()) as FaultInput
        // A rule for an op no call has would never match, and a test relying
        // on it would pass without the failure ever happening.
        if (!SDK_OPS.includes(input.op)) {
          throw new BadRequest(`Unknown op ${input.op}. One of: ${SDK_OPS.join(', ')}`)
        }
        const rule: FaultRule = {
          id: `fault-${++faultSeq}`,
          op: input.op,
          device: input.device,
          remaining: input.count ?? 1,
          status: input.status ?? 500,
          message: input.message,
        }
        faults.push(rule)
        return Response.json(rule)
      }
      if (method === 'DELETE') {
        faults = []
        return new Response(null, { status: 204 })
      }
    }

    if (resource === 'publish' && method === 'POST') {
      // For the mock's own tests. A scenario waits for the publisher like a
      // device does, since forcing it hides the delay devices really see.
      let published = store.publish()
      if (published === 0) {
        await Bun.sleep(1000 - (Date.now() % 1000) + 5)
        published = store.publish()
      }
      return Response.json({ published })
    }

    return Response.json(
      { error: `No route: ${method} /control/${parts.join('/')}` },
      { status: 404 },
    )
  }

  return {
    async fetch(req) {
      const url = new URL(req.url)
      const [scope, ...parts] = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
      try {
        if (scope === 'sdk') return await routeSdk(req, parts, url)
        if (scope === 'control') return await routeControl(req, parts, url)
      } catch (e) {
        return errorResponse(e)
      }
      return Response.json({ error: `No route: ${url.pathname}` }, { status: 404 })
    },
  }
}

function errorResponse(e: unknown): Response {
  const status =
    e instanceof Fault
      ? e.status
      : e instanceof NotFound
        ? 404
        : e instanceof BadRequest
          ? 400
          : e instanceof Forbidden
            ? 403
            : 500
  return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status })
}

/** The shard events the real SDK would report for an upload of `bytes`. */
function shardCount(bytes: number): number {
  const slabBytes = SECTOR_SIZE * UPLOAD_DATA_SHARDS
  const slabs = bytes > 0 ? Math.ceil(bytes / slabBytes) : 0
  return slabs * (UPLOAD_DATA_SHARDS + UPLOAD_PARITY_SHARDS)
}

function wire(row: ObjectRow): WireObject {
  return {
    id: row.id,
    metadata: toHex(row.metadata),
    size: String(row.size),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
