/**
 * The wire format between the mock network server, the SDK client each app
 * runs, and the control client tests and agents use. Plain JSON over HTTP, so
 * any process that can call fetch can join: a CLI daemon, the desktop daemon,
 * or the mobile app inside a simulator.
 *
 * Byte fields travel as hex, and sizes as decimal strings because they are
 * bigints in the SDK interface.
 */

/** The app key every test-mode app signs in with. */
export const MOCK_APP_KEY_HEX = 'ab'.repeat(32)

/** The recovery phrase every test-mode app signs in with. */
export const MOCK_PHRASE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

/** Names the calling device in the server's request log and fault rules. */
export const DEVICE_HEADER = 'x-sim-device'

/**
 * Bytes already in the packer when a file is added. The real SDK holds a
 * partial slab in memory and only touches the network during an add once a
 * slab fills, so the server uses this to decide whether an add needs the
 * network at all.
 */
export const PACKED_BYTES_HEADER = 'x-sim-packed-bytes'

/** Where an app in test mode opens its control socket: `<RELAY_PATH>/<device>`. */
export const RELAY_PATH = '/relay'

/** Every SDK call the server serves, and the unit fault rules match on. */
export const SDK_OPS = [
  'events',
  'getObject',
  'updateMetadata',
  'pin',
  'delete',
  'download',
  'blob',
  'upload',
  'cancelUpload',
  'commit',
  'account',
  'prune',
  'shared',
] as const
export type SdkOp = (typeof SDK_OPS)[number]

export type WireObject = {
  id: string
  metadata: string
  size: string
  createdAt: number
  updatedAt: number
}

/** `updatedAt` is the event's stream position, not the object's own updatedAt. */
export type WireEvent = {
  id: string
  deleted: boolean
  updatedAt: number
  object?: WireObject
}

export type WireBlob = { blobId: string; size: string }

export type WireUpload = {
  uploadId: string
  /** Delay between simulated shard progress events, from the upload rate. */
  shardDelayMs: number
}

export type WireAccount = {
  pinnedData: string
  pinnedSize: string
  maxPinnedData: string
}

/** A device whose app holds its control socket open. */
export type ConnectedDevice = {
  /** Sockets the device has opened, counting this one. It rises every time the app reconnects. */
  sockets: number
  /** What the app last reported. A suspended app's socket stays open, so this says whether it can answer. */
  lifecycle: 'foreground' | 'background'
}

/** Network conditions a test sets. Each applies until changed. */
export type Conditions = {
  offline: string[]
  latencyMs: number
  /**
   * Upload rate in bytes of file data per second, shared by every device. 0
   * is unlimited. The app measures its speed over the shards the client
   * reports, every slab's data and parity sectors, so the speed it shows is
   * several times this rate.
   */
  uploadBytesPerSec: number
}

/** A fault that fails the next `count` matching calls with `status`. */
export type FaultRule = {
  id: string
  op: SdkOp
  device?: string
  remaining: number
  status: number
  message: string
}

export type FaultInput = Omit<FaultRule, 'id' | 'remaining' | 'status'> & {
  count?: number
  status?: number
}

/**
 * SDK calls the network holds, unanswered, until a test releases them: every
 * call to `op`, from `device` when one is named. It keeps an app in the middle
 * of a call for as long as a step needs.
 */
export type HoldRule = {
  op: SdkOp
  device?: string
  /** Calls waiting on the hold now, not counting any whose client has disconnected. */
  waiting: number
}

/** One stored object as a test sees it, with its metadata decoded. */
export type InspectedObject = {
  id: string
  pinned: boolean
  size: number
  createdAt: number
  updatedAt: number
  uploadedBy: string | null
  contentHash: string | null
  metadata: Record<string, unknown> | null
}

export type InspectedEvent = { id: string; deleted: boolean; position: number | null }

export type RequestRecord = {
  seq: number
  at: number
  device: string
  op: SdkOp
  status: number
  detail: string | null
}

export type Summary = {
  objects: number
  pinned: number
  deletedEvents: number
  bytes: number
  devices: string[]
  conditions: Conditions
  faults: FaultRule[]
}

export function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let out = ''
  for (const b of u8) out += b.toString(16).padStart(2, '0')
  return out
}

export function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  if (hex.length % 2 !== 0) throw new Error('Invalid hex string')
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}
