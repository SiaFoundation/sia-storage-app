/**
 * The client tests and agents use to seed, inspect and fault the mock network.
 * Nothing here goes through the conditions it sets, so a test can still read
 * the indexer while every device is offline.
 */
import type { FileMetadata } from '@siastorage/core/types'
import {
  type ApprovalMode,
  type AuthSummary,
  type Conditions,
  type ConnectedDevice,
  type FaultInput,
  type FaultRule,
  type HoldRule,
  type InspectedEvent,
  type InspectedObject,
  type InspectedShare,
  type RequestRecord,
  type SdkOp,
  type Summary,
  toHex,
  type WireObject,
} from '../protocol'

export type NetworkControl = ReturnType<typeof createNetworkControl>

export function createNetworkControl(url: string) {
  const base = `${url.replace(/\/$/, '')}/control`

  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...init.headers },
    })
    if (res.status === 204) return undefined as T
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`)
    return body as T
  }

  const json = (method: string, body: unknown): RequestInit => ({
    method,
    body: JSON.stringify(body),
  })

  return {
    summary: () => call<Summary>('/summary'),
    /** Pinned objects, which is what devices can see. `unpinned` adds uploads not yet pinned. */
    objects: (opts: { unpinned?: boolean } = {}) =>
      call<InspectedObject[]>(`/objects${opts.unpinned ? '?unpinned=1' : ''}`),
    events: () => call<InspectedEvent[]>('/events'),
    /** Every live sharing key, with each attached object as a recipient sees it. */
    shares: () => call<InspectedShare[]>('/shares'),
    /** Publishes an object as if another device had uploaded and pinned it. */
    inject: (input: { metadata: FileMetadata; data?: Uint8Array }) =>
      call<WireObject>(
        '/objects',
        json('POST', {
          metadata: input.metadata,
          data: input.data ? toHex(input.data) : undefined,
        }),
      ),
    requests: (filter: { device?: string; op?: string; since?: number } = {}) => {
      const q = new URLSearchParams()
      for (const [k, v] of Object.entries(filter)) if (v !== undefined) q.set(k, String(v))
      return call<RequestRecord[]>(`/requests?${q}`)
    },
    setConditions: (changes: Partial<Conditions>) =>
      call<Conditions>('/conditions', json('PATCH', changes)),
    setOffline: (device: string, offline: boolean) =>
      call<Conditions>(`/conditions/offline/${encodeURIComponent(device)}`, {
        method: offline ? 'PUT' : 'DELETE',
      }),
    /** Devices whose app holds a control socket open right now. */
    connectedDevices: () => call<Record<string, ConnectedDevice>>('/devices'),
    /** Calls a method on a device's app through its control socket. */
    callDevice: async <T = unknown>(
      device: string,
      method: string,
      args: unknown[] = [],
      timeoutMs?: number,
    ): Promise<T> =>
      (
        await call<{ result: T }>(
          `/devices/${encodeURIComponent(device)}/call`,
          json('POST', { method, args, timeoutMs }),
        )
      ).result,
    /** Sign-in as the network holds it: the approval mode, every request, the registered app keys. */
    auth: () => call<AuthSummary>('/auth'),
    /**
     * `manual` leaves each connection request pending until `approve` or
     * `deny`, which is how a test stays on the screen that waits for a person.
     */
    setApprovalMode: (mode: ApprovalMode) =>
      call<{ mode: ApprovalMode }>('/auth', json('PATCH', { mode })),
    /** Approves one pending request, or every pending one, and returns how many. */
    approve: async (requestId?: string) =>
      (await call<{ settled: number }>('/auth/approve', json('POST', { requestId }))).settled,
    deny: async (requestId?: string) =>
      (await call<{ settled: number }>('/auth/deny', json('POST', { requestId }))).settled,
    addFault: (input: FaultInput) => call<FaultRule>('/faults', json('POST', input)),
    faults: () => call<FaultRule[]>('/faults'),
    clearFaults: () => call<void>('/faults', { method: 'DELETE' }),
    /** Holds every matching SDK call unanswered until `releaseHolds`. */
    hold: (input: { op: SdkOp; device?: string }) => call<void>('/holds', json('POST', input)),
    holds: () => call<HoldRule[]>('/holds'),
    /** Answers every held call and removes every hold. */
    releaseHolds: () => call<void>('/holds', { method: 'DELETE' }),
    /**
     * Publishes pending events now, waiting for the next second if a batch
     * already went out in this one. For testing the mock itself.
     */
    publish: () => call<{ published: number }>('/publish', { method: 'POST' }),
  }
}
