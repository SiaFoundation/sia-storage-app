/*
 * The Cloud Files calls the provider makes, over Bun's FFI.
 *
 * Windows keeps a sync root's files as placeholders, each carrying an
 * identity the provider chose, and asks the provider for a file's bytes when
 * something reads it. `CloudFiles` is everything the folder's logic asks of
 * the system, so a test can stand in for it. `connectCloudFiles` is the real
 * one. Structures are laid out by hand to match cfapi.h on a 64-bit build,
 * and callbacks arrive through `shim.c`, which Bun compiles when the provider
 * connects.
 */
import { cc, dlopen, ptr } from 'bun:ffi'
import { open } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { logger } from '@siastorage/logger'

/** CF_CALLBACK_TYPE, for the callbacks `shim.c` registers. */
export const Callback = {
  fetch: 0,
  opened: 5,
  closed: 6,
  dehydrated: 8,
  deleted: 10,
  renamed: 12,
} as const

/** One callback, as `shim.c` copied it. */
export type CloudEvent = {
  type: number
  transferKey: bigint
  requestKey: bigint
  /** `fetch`: the range the system needs. */
  offset: number
  length: number
  /** The identity the placeholder carries. */
  identity: string
  /**
   * Where the placeholder is now, absolute. Empty where Windows gives no
   * path, as it does for `fetch`, and for a path over 1,023 characters.
   */
  path: string
}

export type Placeholder = {
  identity: string
  size: number
  createdAt: number
  modifiedAt: number
  directory: boolean
  /** On the network, which is what lets the system remove the bytes. */
  inSync: boolean
}

export type CloudFiles = {
  /** The next callback waiting, `dropped` once after callbacks were lost, or null. */
  poll(): CloudEvent | 'dropped' | null
  /** Creates a placeholder with no bytes at `path`. False when the name is taken. */
  create(path: string, placeholder: Placeholder): boolean
  /** Makes a plain file or folder a placeholder, keeping its bytes on disk. */
  convert(path: string, identity: string, inSync: boolean): void
  /**
   * Gives a placeholder a new identity and in-sync state. With `dehydrate`
   * it also takes the new size and times and drops the bytes on disk, which
   * the system refuses for a pinned file. False when the file is in use.
   */
  update(path: string, placeholder: Placeholder, dehydrate?: boolean): boolean
  /**
   * Removes a placeholder's bytes from disk. `refused` for a file the system
   * keeps, one that is pinned or not in sync, and `busy` for one in use.
   */
  dehydrate(path: string): 'done' | 'refused' | 'busy'
  /** Has the system fetch a placeholder's bytes, which arrive as a `fetch` callback. */
  hydrate(path: string): void
  /** Hands the system `data`, which sits at `offset` in the file a fetch asked for. */
  transfer(event: CloudEvent, data: Uint8Array, offset: number): void
  /** Fails a fetch from `offset` on, so the read that caused it fails now. */
  failTransfer(event: CloudEvent, offset: number, length: number): void
  /** A placeholder's identity and in-sync state. Null for a plain or missing file. */
  placeholder(path: string): { identity: string; inSync: boolean } | null
  /** Null for a missing file. */
  attributes(path: string): { hydrated: boolean; pinned: boolean; unpinned: boolean } | null
  /** Sets or clears "Always keep on this device" for a file. */
  pin(path: string, pinned: boolean): void
  disconnect(): void
}

const wide = (s: string) => Buffer.from(`${s}\0`, 'utf16le')

/** Windows file time: 100 ns ticks since 1601. */
const fileTime = (ms: number) => BigInt(Math.round(ms)) * 10000n + 116444736000000000n

const FILE_ATTRIBUTE = {
  directory: 0x10,
  normal: 0x80,
  /** OFFLINE and RECALL_ON_DATA_ACCESS: the bytes are not all on disk. */
  notOnDisk: 0x1000 | 0x400000,
  pinned: 0x80000,
  unpinned: 0x100000,
}

/** ERROR_CLOUD_FILE_PINNED and ERROR_CLOUD_FILE_NOT_IN_SYNC: the system will not let the bytes go. */
const KEPT_BY_THE_SYSTEM = [0x80070188, 0x80070179]
/** ERROR_ALREADY_EXISTS and ERROR_FILE_EXISTS. */
const NAME_TAKEN = [0x800700b7, 0x80070050]

function check(what: string, code: number): void {
  if (code !== 0) throw new Error(`${what} failed with 0x${(code >>> 0).toString(16)}`)
}

/** CF_FS_METADATA: four file times, the attributes, then the size. */
function writeMetadata(into: Buffer, at: number, placeholder: Placeholder): void {
  into.writeBigInt64LE(fileTime(placeholder.createdAt), at)
  for (const offset of [8, 16, 24]) {
    into.writeBigInt64LE(fileTime(placeholder.modifiedAt), at + offset)
  }
  into.writeUInt32LE(
    placeholder.directory ? FILE_ATTRIBUTE.directory : FILE_ATTRIBUTE.normal,
    at + 32,
  )
  into.writeBigInt64LE(BigInt(placeholder.directory ? 0 : placeholder.size), at + 40)
}

/** Connects to the sync root registered at `root` and starts taking its callbacks. */
export function connectCloudFiles(root: string): CloudFiles {
  const shim = cc({
    source: join(import.meta.dir, 'shim.c'),
    symbols: {
      cf_poll: { args: ['ptr'], returns: 'int' },
      cf_table: { args: ['ptr'], returns: 'void' },
    },
  }).symbols
  const cf = dlopen('cldapi.dll', {
    CfConnectSyncRoot: { args: ['ptr', 'ptr', 'ptr', 'u32', 'ptr'], returns: 'i32' },
    CfDisconnectSyncRoot: { args: ['i64'], returns: 'i32' },
    CfCreatePlaceholders: { args: ['ptr', 'ptr', 'u32', 'u32', 'ptr'], returns: 'i32' },
    CfConvertToPlaceholder: { args: ['i64', 'ptr', 'u32', 'u32', 'ptr', 'ptr'], returns: 'i32' },
    CfUpdatePlaceholder: {
      args: ['i64', 'ptr', 'ptr', 'u32', 'ptr', 'u32', 'u32', 'ptr', 'ptr'],
      returns: 'i32',
    },
    CfDehydratePlaceholder: { args: ['i64', 'i64', 'i64', 'u32', 'ptr'], returns: 'i32' },
    CfGetPlaceholderInfo: { args: ['i64', 'u32', 'ptr', 'u32', 'ptr'], returns: 'i32' },
    CfExecute: { args: ['ptr', 'ptr'], returns: 'i32' },
  }).symbols
  const kernel = dlopen('kernel32.dll', {
    CreateFileW: { args: ['ptr', 'u32', 'u32', 'ptr', 'u32', 'u32', 'ptr'], returns: 'i64' },
    CloseHandle: { args: ['i64'], returns: 'i32' },
    GetFileAttributesW: { args: ['ptr'], returns: 'u32' },
    SetFileAttributesW: { args: ['ptr', 'u32'], returns: 'i32' },
  }).symbols

  // CF_CALLBACK_REGISTRATION for each callback, and the entry that ends the table.
  const table = Buffer.alloc(16 * (Object.keys(Callback).length + 1))
  shim.cf_table(ptr(table))
  const key = Buffer.alloc(8)
  check('CfConnectSyncRoot', cf.CfConnectSyncRoot(ptr(wide(root)), ptr(table), null, 0, ptr(key)))
  const connectionKey = key.readBigInt64LE(0)
  // A callback's path starts at the volume's root, with no drive.
  const volume = root.slice(0, root.indexOf('\\'))
  // An `Event` of shim.c: 40 bytes of fields, the identity, then the path and its length.
  const event = Buffer.alloc(40 + 256 + 8 + 2 * 1024)

  /**
   * Runs `use` with a handle to the file or folder, or returns null when it
   * cannot be opened. Opening a placeholder to read its data has the system
   * fetch the whole file first, through this process, which would wait on
   * itself for the fetch's 60 seconds. So a handle asks only for what the
   * Cloud Files calls need, the right to change the file's permissions.
   * `exclusive` also asks to read, and shares the file with nobody, so it
   * fails while anything else has the file open. It is for a file whose bytes
   * are on disk.
   */
  function withHandle<T>(path: string, exclusive: boolean, use: (handle: bigint) => T): T | null {
    const handle = kernel.CreateFileW(
      ptr(wide(path)),
      // FILE_READ_ATTRIBUTES and WRITE_DAC, and FILE_READ_DATA
      0x80 | 0x40000 | (exclusive ? 1 : 0),
      // FILE_SHARE_READ, WRITE and DELETE
      exclusive ? 0 : 7,
      null,
      3, // OPEN_EXISTING
      0x02000000, // FILE_FLAG_BACKUP_SEMANTICS, which opens a folder too
      null,
    )
    if (handle === -1n) return null
    try {
      return use(handle)
    } finally {
      kernel.CloseHandle(handle)
    }
  }

  function attributes(path: string): ReturnType<CloudFiles['attributes']> {
    const bits = kernel.GetFileAttributesW(ptr(wide(path)))
    if (bits === 0xffffffff) return null
    return {
      hydrated: (bits & FILE_ATTRIBUTE.notOnDisk) === 0,
      pinned: (bits & FILE_ATTRIBUTE.pinned) !== 0,
      unpinned: (bits & FILE_ATTRIBUTE.unpinned) !== 0,
    }
  }

  /** CF_OPERATION_INFO for TRANSFER_DATA, answering `fetch`. */
  function transferOperation(fetch: CloudEvent): Buffer {
    const operation = Buffer.alloc(48)
    operation.writeUInt32LE(48, 0)
    operation.writeBigInt64LE(connectionKey, 8)
    operation.writeBigInt64LE(fetch.transferKey, 16)
    operation.writeBigInt64LE(fetch.requestKey, 40)
    return operation
  }

  return {
    poll() {
      const result = shim.cf_poll(ptr(event))
      if (result === 0) return null
      if (result < 0) return 'dropped'
      const pathLength = event.readUInt32LE(296)
      return {
        type: event.readUInt32LE(0),
        transferKey: event.readBigInt64LE(8),
        requestKey: event.readBigInt64LE(16),
        offset: Number(event.readBigInt64LE(24)),
        length: Number(event.readBigInt64LE(32)),
        identity: event.subarray(40, 40 + event.readUInt32LE(4)).toString(),
        path:
          pathLength === 0
            ? ''
            : volume + event.subarray(304, 304 + 2 * pathLength).toString('utf16le'),
      }
    },

    create(path, placeholder) {
      const name = wide(basename(path))
      const identity = Buffer.from(placeholder.identity)
      // CF_PLACEHOLDER_CREATE_INFO
      const info = Buffer.alloc(88)
      info.writeBigUInt64LE(BigInt(ptr(name)), 0)
      writeMetadata(info, 8, placeholder)
      info.writeBigUInt64LE(BigInt(ptr(identity)), 56)
      info.writeUInt32LE(identity.length, 64)
      // DISABLE_ON_DEMAND_POPULATION 1 for a folder, since the provider
      // creates every placeholder itself, and MARK_IN_SYNC 2.
      info.writeUInt32LE((placeholder.directory ? 1 : 0) | (placeholder.inSync ? 2 : 0), 68)
      const code = cf.CfCreatePlaceholders(ptr(wide(dirname(path))), ptr(info), 1, 0, null)
      const result = info.readInt32LE(72)
      if ([code >>> 0, result >>> 0].some((c) => NAME_TAKEN.includes(c))) return false
      check('CfCreatePlaceholders', code)
      check('CfCreatePlaceholders for the item', result)
      return true
    },

    convert(path, identity, inSync) {
      const id = Buffer.from(identity)
      // CF_CONVERT_FLAG_MARK_IN_SYNC 1
      const code = withHandle(path, false, (handle) =>
        cf.CfConvertToPlaceholder(handle, ptr(id), id.length, inSync ? 1 : 0, null, null),
      )
      if (code === null) throw new Error('The file is in use')
      check('CfConvertToPlaceholder', code)
    },

    update(path, placeholder, dehydrate = false) {
      const identity = Buffer.from(placeholder.identity)
      const metadata = Buffer.alloc(48)
      writeMetadata(metadata, 0, placeholder)
      // CF_UPDATE_FLAG_MARK_IN_SYNC 2, DEHYDRATE 4, CLEAR_IN_SYNC 0x40
      const flags = (placeholder.inSync ? 2 : 0x40) | (dehydrate ? 4 : 0)
      // Dropping the bytes of a file another program has open would leave
      // that program reading the old bytes at the new size.
      const onDisk = attributes(path)?.hydrated === true
      const code = withHandle(path, dehydrate && onDisk, (handle) =>
        cf.CfUpdatePlaceholder(
          handle,
          dehydrate ? ptr(metadata) : null,
          ptr(identity),
          identity.length,
          null,
          0,
          flags,
          null,
          null,
        ),
      )
      if (code === null) return false
      check('CfUpdatePlaceholder', code)
      return true
    },

    dehydrate(path) {
      const code = withHandle(path, attributes(path)?.hydrated === true, (handle) =>
        cf.CfDehydratePlaceholder(handle, 0n, -1n, 0, null),
      )
      if (code === null) return 'busy'
      if (code === 0) return 'done'
      return KEPT_BY_THE_SYSTEM.includes(code >>> 0) ? 'refused' : 'busy'
    },

    hydrate(path) {
      // Not `CfHydratePlaceholder`, which returns only once the fetch is done,
      // and the fetch is served on this thread. Opening the file to read has
      // the system fetch it too, without blocking this thread.
      open(path, 'r')
        .then((file) => file.close())
        .catch((e) => logger.error('cloudFiles', 'hydrate_failed', { error: e }))
    },

    transfer(fetch, data, offset) {
      // CF_OPERATION_PARAMETERS.TransferData
      const params = Buffer.alloc(40)
      params.writeUInt32LE(40, 0)
      params.writeBigUInt64LE(BigInt(ptr(data)), 16)
      params.writeBigInt64LE(BigInt(offset), 24)
      params.writeBigInt64LE(BigInt(data.length), 32)
      check('CfExecute(TRANSFER_DATA)', cf.CfExecute(ptr(transferOperation(fetch)), ptr(params)))
    },

    failTransfer(fetch, offset, length) {
      const params = Buffer.alloc(40)
      params.writeUInt32LE(40, 0)
      params.writeInt32LE(0xc0000001 | 0, 12) // STATUS_UNSUCCESSFUL
      params.writeBigInt64LE(BigInt(offset), 24)
      params.writeBigInt64LE(BigInt(length), 32)
      cf.CfExecute(ptr(transferOperation(fetch)), ptr(params))
    },

    placeholder(path) {
      // CF_PLACEHOLDER_BASIC_INFO, with room for the longest identity.
      const info = Buffer.alloc(28 + 4096)
      const code = withHandle(path, false, (handle) =>
        cf.CfGetPlaceholderInfo(handle, 0, ptr(info), info.length, null),
      )
      if (code !== 0) return null
      return {
        identity: info.subarray(28, 28 + info.readUInt32LE(24)).toString(),
        inSync: info.readUInt32LE(4) === 1,
      }
    },

    attributes,

    pin(path, pinned) {
      const attributes = kernel.GetFileAttributesW(ptr(wide(path)))
      if (attributes === 0xffffffff) return
      const cleared = attributes & ~(FILE_ATTRIBUTE.pinned | FILE_ATTRIBUTE.unpinned)
      kernel.SetFileAttributesW(ptr(wide(path)), cleared | (pinned ? FILE_ATTRIBUTE.pinned : 0))
    },

    disconnect() {
      cf.CfDisconnectSyncRoot(connectionKey)
    },
  }
}
