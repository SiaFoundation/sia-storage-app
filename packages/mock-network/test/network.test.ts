import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SdkAdapter } from '@siastorage/core/adapters'
import { SECTOR_SIZE, UPLOAD_DATA_SHARDS, UPLOAD_PARITY_SHARDS } from '@siastorage/core/config'
import { decodeFileMetadata, encodeFileMetadata } from '@siastorage/core/encoding/fileMetadata'
import type { FileMetadata } from '@siastorage/core/types'
import { createNodeRemoteSdk as createRemoteSdk } from '../src/client/node'
import { createNetworkControl, type NetworkControl } from '../src/control'
import { type MockNetwork, startMockNetwork } from '../src/server'

let dir: string
let network: MockNetwork
let control: NetworkControl
let phone: SdkAdapter
let laptop: SdkAdapter

function meta(name: string, size: number, extra: Partial<FileMetadata> = {}): FileMetadata {
  const now = Date.now()
  return {
    id: `file-${name}`,
    name,
    type: 'text/plain',
    kind: 'file',
    size,
    hash: `sha256:${name}`,
    createdAt: now,
    updatedAt: now,
    trashedAt: null,
    ...extra,
  }
}

async function upload(sdk: SdkAdapter, name: string, bytes: Uint8Array) {
  const path = join(dir, name)
  writeFileSync(path, bytes)
  const packer = await sdk.uploadPacked({
    dataShards: UPLOAD_DATA_SHARDS,
    parityShards: UPLOAD_PARITY_SHARDS,
  })
  await packer.addPath(path)
  const [object] = await packer.finalize()
  object.updateMetadata(encodeFileMetadata(meta(name, bytes.length)))
  await sdk.pinObject(object)
  return object
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mock-network-'))
  network = startMockNetwork({ dir: join(dir, 'state'), publishEveryMs: 0 })
  control = createNetworkControl(network.url)
  phone = createRemoteSdk({ url: network.url, device: 'phone' })
  laptop = createRemoteSdk({ url: network.url, device: 'laptop' })
})

afterEach(async () => {
  await network.stop()
  rmSync(dir, { recursive: true, force: true })
})

describe('mock network', () => {
  test('an object one device uploads and pins reaches another device with its bytes', async () => {
    const bytes = new TextEncoder().encode('hello from the phone')
    const uploaded = await upload(phone, 'hello.txt', bytes)
    await control.publish()

    const events = await laptop.objectEvents(undefined, 10)
    expect(events.map((e) => e.id)).toEqual([uploaded.id()])
    const seen = events[0].object
    expect(seen).toBeDefined()
    expect(decodeFileMetadata(seen!.metadata()).name).toBe('hello.txt')
    expect(Number(seen!.size())).toBe(bytes.length)

    const data = await laptop.downloadByObjectId(uploaded.id())
    expect(new Uint8Array(data)).toEqual(bytes)
  })

  test('an uploaded object stays out of the event stream until it is pinned', async () => {
    const path = join(dir, 'unpinned.bin')
    writeFileSync(path, new Uint8Array(10))
    const packer = await phone.uploadPacked({ dataShards: 10, parityShards: 20 })
    await packer.addPath(path)
    await packer.finalize()
    await control.publish()

    expect(await laptop.objectEvents(undefined, 10)).toEqual([])
    expect(await control.objects({ unpinned: true })).toHaveLength(1)
    expect(await control.objects()).toHaveLength(0)
  })

  test('a device paging with a cursor sees each change once, in order', async () => {
    const a = await upload(phone, 'a.txt', new Uint8Array([1]))
    const b = await upload(phone, 'b.txt', new Uint8Array([2]))
    await control.publish()

    const first = await laptop.objectEvents(undefined, 1)
    expect(first.map((e) => e.id)).toEqual([a.id()])
    const cursor = { id: first[0].id, after: first[0].updatedAt }
    const second = await laptop.objectEvents(cursor, 10)
    expect(second.map((e) => e.id)).toEqual([b.id()])

    a.updateMetadata(encodeFileMetadata(meta('a-renamed.txt', 1)))
    await phone.updateObjectMetadata(a)
    await control.publish()
    const last = second[0]
    const third = await laptop.objectEvents({ id: last.id, after: last.updatedAt }, 10)
    expect(third.map((e) => e.id)).toEqual([a.id()])
    expect(decodeFileMetadata(third[0].object!.metadata()).name).toBe('a-renamed.txt')
  })

  test('a metadata edit on a handle stays local until it is sent', async () => {
    const a = await upload(phone, 'a.txt', new Uint8Array([1]))
    a.updateMetadata(encodeFileMetadata(meta('local-only.txt', 1)))
    const [stored] = await control.objects()
    expect(stored.metadata?.name).toBe('a.txt')
  })

  test('a deleted object reaches other devices as a tombstone', async () => {
    const a = await upload(phone, 'a.txt', new Uint8Array([1]))
    await laptop.deleteObject(a.id())
    await control.publish()
    const events = await phone.objectEvents(undefined, 10)
    expect(events).toHaveLength(1)
    expect(events[0].deleted).toBe(true)
    expect(events[0].object).toBeUndefined()
  })

  test('an offline device fails every call while others keep working', async () => {
    await control.setOffline('phone', true)
    await expect(phone.objectEvents(undefined, 10)).rejects.toThrow('Network unavailable')
    await expect(laptop.objectEvents(undefined, 10)).resolves.toEqual([])
    await control.setOffline('phone', false)
    await expect(phone.objectEvents(undefined, 10)).resolves.toEqual([])
  })

  test('two devices taken offline at once both end up offline', async () => {
    await Promise.all([control.setOffline('phone', true), control.setOffline('laptop', true)])
    expect((await control.setConditions({})).offline.sort()).toEqual(['laptop', 'phone'])
  })

  test('an add that fits in the current slab succeeds offline, and finalize needs the network', async () => {
    const path = join(dir, 'small.bin')
    writeFileSync(path, new Uint8Array(100))
    const packer = await phone.uploadPacked({ dataShards: 10, parityShards: 20 })
    await control.setOffline('phone', true)
    await expect(packer.addPath(path)).resolves.toBe(100n)
    await expect(packer.finalize()).rejects.toThrow('Network unavailable')
  })

  test('adds fired together finish in call order, so objects line up with files', async () => {
    const sizes = [300_000, 10, 200_000, 20, 100_000]
    const paths = sizes.map((size, i) => {
      const path = join(dir, `order-${i}.bin`)
      writeFileSync(path, new Uint8Array(size).fill(i + 1))
      return path
    })
    const packer = await phone.uploadPacked({ dataShards: 10, parityShards: 20 })
    await Promise.all(paths.map((p) => packer.addPath(p)))
    const objects = await packer.finalize()
    expect(objects.map((o) => Number(o.size()))).toEqual(sizes)
  })

  test('a fault fails the named call the given number of times, then clears', async () => {
    await control.addFault({ op: 'commit', device: 'phone', count: 1, message: 'host timeout' })
    await expect(upload(phone, 'a.txt', new Uint8Array([1]))).rejects.toThrow('host timeout')
    await expect(upload(phone, 'a.txt', new Uint8Array([1]))).resolves.toBeDefined()
    expect(await control.faults()).toEqual([])
  })

  test('the request log records who called what and how it ended', async () => {
    await control.addFault({ op: 'events', count: 1, message: 'boom', status: 502 })
    await phone.objectEvents(undefined, 10).catch(() => {})
    await laptop.objectEvents(undefined, 10)
    const log = await control.requests({ op: 'events' })
    expect(log.map((r) => [r.device, r.status])).toEqual([
      ['phone', 502],
      ['laptop', 200],
    ])
  })

  test('the upload rate paces shard progress and delays the commit', async () => {
    await control.setConditions({ uploadBytesPerSec: 10 * 1024 * 1024 })
    const size = 5 * 1024 * 1024
    const path = join(dir, 'big.bin')
    writeFileSync(path, new Uint8Array(size))
    let shards = 0
    const packer = await phone.uploadPacked({
      dataShards: 10,
      parityShards: 20,
      shardUploaded: { progress: () => shards++ },
    })
    await packer.addPath(path)
    const started = Date.now()
    await packer.finalize()
    expect(Date.now() - started).toBeGreaterThanOrEqual(450)
    expect(shards).toBe(Math.ceil(size / (SECTOR_SIZE * 10)) * 30)
  })

  test('a cancelled upload gives its time on the link back to the next one', async () => {
    await control.setConditions({ uploadBytesPerSec: 1024 * 1024 })
    const path = (name: string, size: number) => {
      const p = join(dir, name)
      writeFileSync(p, new Uint8Array(size))
      return p
    }
    const big = await phone.uploadPacked({ dataShards: 10, parityShards: 20 })
    await big.addPath(path('big.bin', 4 * 1024 * 1024))
    const abandoned = big.finalize().catch(() => null)
    await Bun.sleep(200)
    big.cancel()
    await abandoned

    const small = await laptop.uploadPacked({ dataShards: 10, parityShards: 20 })
    await small.addPath(path('small.bin', 256 * 1024))
    const started = Date.now()
    await small.finalize()
    // Behind the cancelled upload's reservation this would take about 4s.
    expect(Date.now() - started).toBeLessThan(2000)
  })

  test('a new upload from a device hands back the link time of one it never finished', async () => {
    await control.setConditions({ uploadBytesPerSec: 1024 * 1024 })
    const path = (name: string, size: number) => {
      const p = join(dir, name)
      writeFileSync(p, new Uint8Array(size))
      return p
    }
    const big = await phone.uploadPacked({ dataShards: 10, parityShards: 20 })
    await big.addPath(path('big.bin', 4 * 1024 * 1024))
    const abandoned = big.finalize().catch(() => null)
    await Bun.sleep(200)

    // The same device again, as a relaunched app would be, with no cancel sent.
    const relaunched = createRemoteSdk({ url: network.url, device: 'phone' })
    const small = await relaunched.uploadPacked({ dataShards: 10, parityShards: 20 })
    await small.addPath(path('small.bin', 256 * 1024))
    const started = Date.now()
    await small.finalize()
    // Behind the abandoned upload's reservation this would take about 4s.
    expect(Date.now() - started).toBeLessThan(2000)
    expect(await abandoned).toBeNull()
    // The abandoned client keeps pacing its shards over the 4s it reserved,
    // too close to bun's 5s default timeout.
  }, 15_000)

  test('a held call waits unanswered until the hold is released', async () => {
    await control.hold({ op: 'pin', device: 'phone' })
    const pinned = upload(phone, 'held.txt', new Uint8Array([1, 2, 3]))
    await waitForHeld()
    expect((await control.objects({ unpinned: true })).map((o) => o.pinned)).toEqual([false])
    await control.releaseHolds()
    await pinned
    expect((await control.objects()).length).toBe(1)
    expect(await control.holds()).toEqual([])

    async function waitForHeld() {
      for (let i = 0; i < 100; i++) {
        if ((await control.holds()).some((h) => h.waiting > 0)) return
        await Bun.sleep(20)
      }
      throw new Error('the pin was never held')
    }
  })

  test('a held call whose client disconnects stops counting as waiting', async () => {
    const path = join(dir, 'gone.txt')
    writeFileSync(path, new Uint8Array([1]))
    const packer = await phone.uploadPacked({
      dataShards: UPLOAD_DATA_SHARDS,
      parityShards: UPLOAD_PARITY_SHARDS,
    })
    await packer.addPath(path)
    const [object] = await packer.finalize()
    await control.hold({ op: 'pin' })
    const controller = new AbortController()
    const pin = fetch(`${network.url}/sdk/objects/${object.id()}/pin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sim-device': 'phone' },
      body: JSON.stringify({ metadata: '' }),
      signal: controller.signal,
    }).catch(() => null)
    const waiting = async () => (await control.holds())[0]?.waiting ?? 0
    for (let i = 0; i < 100 && (await waiting()) === 0; i++) await Bun.sleep(20)
    expect(await waiting()).toBe(1)
    controller.abort()
    await pin
    for (let i = 0; i < 100 && (await waiting()) > 0; i++) await Bun.sleep(20)
    expect(await waiting()).toBe(0)
  })

  test('a fault for an op no call has is refused', async () => {
    await expect(control.addFault({ op: 'downloads' as never, message: 'x' })).rejects.toThrow(
      'Unknown op downloads',
    )
  })

  test('a ranged download returns exactly the requested bytes', async () => {
    const bytes = new Uint8Array(SECTOR_SIZE + 100).map((_, i) => i % 251)
    const object = await upload(phone, 'range.bin', bytes)
    const dl = await laptop.download(object, { offset: 50n, length: BigInt(SECTOR_SIZE) })
    const chunks: Uint8Array[] = []
    for (;;) {
      const chunk = await dl.read()
      if (chunk.byteLength === 0) break
      chunks.push(new Uint8Array(chunk))
    }
    const got = Buffer.concat(chunks)
    expect(got.length).toBe(SECTOR_SIZE)
    expect(new Uint8Array(got)).toEqual(bytes.slice(50, 50 + SECTOR_SIZE))
  })

  test('a sealed object reopens with its id, size and metadata and no request', async () => {
    const object = await upload(phone, 'sealed.txt', new Uint8Array([1, 2, 3]))
    const sealed = object.seal(phone.appKey())
    const before = (await control.requests()).length
    const reopened = laptop.openPinnedObject(laptop.appKey(), {
      ...sealed,
      fileId: 'file-sealed.txt',
      indexerURL: network.url,
    })
    expect(reopened.id()).toBe(object.id())
    expect(reopened.size()).toBe(3n)
    expect(decodeFileMetadata(reopened.metadata()).name).toBe('sealed.txt')
    expect((await control.requests()).length).toBe(before)
  })

  test('state survives a server restart on the same directory', async () => {
    const object = await upload(phone, 'kept.txt', new Uint8Array([9]))
    await control.publish()
    const stateDir = join(dir, 'state')
    await network.stop()
    network = startMockNetwork({ dir: stateDir })
    const again = createRemoteSdk({ url: network.url, device: 'laptop' })
    const events = await again.objectEvents(undefined, 10)
    expect(events.map((e) => e.id)).toEqual([object.id()])
    const next = await upload(
      createRemoteSdk({ url: network.url, device: 'phone' }),
      'next.txt',
      new Uint8Array([1]),
    )
    expect(next.id()).not.toBe(object.id())
  })

  test('an injected object looks to devices like one another device published', async () => {
    const data = new TextEncoder().encode('from elsewhere')
    const injected = await control.inject({ metadata: meta('elsewhere.txt', data.length), data })
    await control.publish()
    const [event] = await phone.objectEvents(undefined, 10)
    expect(event.id).toBe(injected.id)
    expect(new Uint8Array(await phone.downloadByObjectId(injected.id))).toEqual(data)
  })

  test('a change stays out of the stream until the publisher runs', async () => {
    const a = await upload(phone, 'a.txt', new Uint8Array([1]))
    expect(await laptop.objectEvents(undefined, 10)).toEqual([])
    await control.publish()
    expect((await laptop.objectEvents(undefined, 10)).map((e) => e.id)).toEqual([a.id()])
  })

  test('events published together share a whole-second position and page by id', async () => {
    const objects = []
    for (const name of ['a', 'b', 'c'])
      objects.push(await upload(phone, `${name}.txt`, new Uint8Array([1])))
    await control.publish()
    const all = await laptop.objectEvents(undefined, 10)
    expect(new Set(all.map((e) => e.updatedAt.getTime())).size).toBe(1)
    expect(all[0].updatedAt.getTime() % 1000).toBe(0)
    const [first] = await laptop.objectEvents(undefined, 1)
    const rest = await laptop.objectEvents({ id: first.id, after: first.updatedAt }, 10)
    expect(rest.map((e) => e.id)).toEqual(all.slice(1).map((e) => e.id))
  })

  test('pinning or editing an object deleted alone from its upload fails, and deleting it again is not found', async () => {
    const a = await upload(phone, 'a.txt', new Uint8Array([1]))
    await phone.deleteObject(a.id())
    await expect(laptop.pinObject(a)).rejects.toThrow('object contains unpinned slab')
    await expect(laptop.updateObjectMetadata(a)).rejects.toThrow('object contains unpinned slab')
    await expect(laptop.deleteObject(a.id())).rejects.toThrow('object not found')
  })

  test('an object deleted while another from its upload lives comes back when a device edits it', async () => {
    const packer = await phone.uploadPacked({
      dataShards: UPLOAD_DATA_SHARDS,
      parityShards: UPLOAD_PARITY_SHARDS,
    })
    for (const name of ['a.txt', 'b.txt']) {
      writeFileSync(join(dir, name), new TextEncoder().encode(name))
      await packer.addPath(join(dir, name))
    }
    const [a, b] = await packer.finalize()
    for (const object of [a, b]) {
      object.updateMetadata(encodeFileMetadata(meta('x.txt', 5)))
      await phone.pinObject(object)
    }
    await phone.deleteObject(a.id())

    await laptop.updateObjectMetadata(a)
    await control.publish()
    const events = await laptop.objectEvents(undefined, 10)
    expect(events.find((e) => e.id === a.id())?.deleted).toBe(false)
    expect(new TextDecoder().decode(await laptop.downloadByObjectId(a.id()))).toBe('a.txt')

    await phone.deleteObject(a.id())
    await phone.deleteObject(b.id())
    await expect(laptop.pinObject(a)).rejects.toThrow('object contains unpinned slab')
  })

  test('an empty file uploads but cannot be pinned', async () => {
    const path = join(dir, 'empty.bin')
    writeFileSync(path, new Uint8Array(0))
    const packer = await phone.uploadPacked({ dataShards: 10, parityShards: 20 })
    await packer.addPath(path)
    const [object] = await packer.finalize()
    await expect(phone.pinObject(object)).rejects.toThrow('object must have at least one slab')
  })

  test('an add after finalize fails with upload closed', async () => {
    const path = join(dir, 'late.bin')
    writeFileSync(path, new Uint8Array(10))
    const packer = await phone.uploadPacked({ dataShards: 10, parityShards: 20 })
    await packer.addPath(path)
    await packer.finalize()
    await expect(packer.addPath(path)).rejects.toThrow('upload closed')
  })

  test('after a cancel, adds and finalize fail with upload closed', async () => {
    const path = join(dir, 'cancelled.bin')
    writeFileSync(path, new Uint8Array(10))
    const packer = await phone.uploadPacked({ dataShards: 10, parityShards: 20 })
    await packer.addPath(path)
    packer.cancel()
    await expect(packer.addPath(path)).rejects.toThrow('upload closed')
    await expect(packer.finalize()).rejects.toThrow('upload closed')
  })

  test('an events page limit outside 1..500 is rejected', async () => {
    await expect(phone.objectEvents(undefined, 501)).rejects.toThrow(
      'limit must be between 1 and 500',
    )
  })
})
