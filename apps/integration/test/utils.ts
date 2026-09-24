import { directoryProviderId, WORKING_SET_ID, type ProviderItem } from '@siastorage/core/types'
import * as crypto from 'crypto'
import * as nodeFs from 'fs'
import * as path from 'path'

export interface UploadState {
  id: string
  status: 'queued' | 'packing' | 'packed' | 'uploading' | 'done' | 'error'
  progress: number
  size: number
  error?: string
  batchId?: string
  batchCount?: number
}

export interface TestFileInput {
  id: string
  name: string
  type: string
  size: number
  hash: string
  uri: string
}

export type TestFileFactory = (tempDir: string) => TestFileInput

export function generateTestFiles(
  count: number,
  options: {
    startId?: number
    sizeBytes?: number
    type?: 'data' | 'image' | 'video' | 'mixed'
  } = {},
): TestFileFactory[] {
  const { startId = 1, sizeBytes, type = 'data' } = options

  return Array.from({ length: count }, (_, i) => {
    const id = startId + i
    const isVideo = type === 'video' || (type === 'mixed' && i % 3 === 0)
    const isImage = type === 'image' || (type === 'mixed' && !isVideo)

    let ext: string
    let mimeType: string
    if (isVideo) {
      ext = '.mp4'
      mimeType = 'video/mp4'
    } else if (isImage) {
      ext = '.jpg'
      mimeType = 'image/jpeg'
    } else {
      ext = '.bin'
      mimeType = 'application/octet-stream'
    }

    const size = sizeBytes ?? 1024 * (id + 1)
    const fileId = `test-file-${id}`

    return (tempDir: string): TestFileInput => {
      const filePath = path.join(tempDir, `${fileId}${ext}`)
      const content = crypto.randomBytes(size)
      nodeFs.writeFileSync(filePath, content)
      const hash = crypto.createHash('sha256').update(content).digest('hex')
      return {
        id: fileId,
        name: `file-${id}${ext}`,
        type: mimeType,
        size,
        hash,
        uri: `file://${filePath}`,
      }
    }
  })
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export async function waitForCondition(
  fn: () => boolean | Promise<boolean>,
  opts: { timeout?: number; interval?: number; message?: string } = {},
): Promise<void> {
  const { timeout = 10_000, interval = 50, message } = opts
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await fn()) return
    await sleep(interval)
  }
  throw new Error(`${message ?? 'Condition'} not met within ${timeout}ms`)
}

/**
 * A newer version of the same name, as another device's upload arrives:
 * a new row id joining the same name-and-directory group.
 */
export async function createNewerVersion(
  app: { app: { files: { create(record: Record<string, unknown>): Promise<unknown> } } },
  first: { name: string; type: string },
  id = 'newer-version',
): Promise<void> {
  const now = Date.now() + 1000
  await app.app.files.create({
    id,
    name: first.name,
    type: first.type,
    kind: 'file',
    size: 123,
    hash: 'sha256:newer',
    trashedAt: null,
    createdAt: now,
    updatedAt: now,
    mediaAssetId: null,
    addedAt: now,
    deletedAt: null,
  })
}

/** The provider surface the feed helpers walk, as the extension calls it. */
export type ProviderFeedHost = {
  app: {
    provider: {
      list(
        container: string | null,
        cursor?: string,
      ): Promise<{ items: ProviderItem[]; cursor?: string; anchor?: string }>
      changes(
        container: string | null,
        anchor: string,
      ): Promise<{
        items: ProviderItem[]
        deletedIds: string[]
        anchor: string
        hasMore: boolean
        expired: boolean
      }>
    }
    directories: { getAll(): Promise<{ id: string }[]> }
    files: { queryLibrary(opts: { limit: number }): Promise<{ id: string }[]> }
  }
}

/** Walks a container's listing to completion and returns the minted anchor. */
export async function drainListing(
  host: ProviderFeedHost,
  container: string | null,
): Promise<{ items: ProviderItem[]; anchor: string }> {
  const items: ProviderItem[] = []
  let cursor: string | undefined
  for (;;) {
    const page = await host.app.provider.list(container, cursor)
    items.push(...page.items)
    if (page.anchor !== undefined) return { items, anchor: page.anchor }
    if (page.cursor === undefined) throw new Error('listing ended without an anchor')
    cursor = page.cursor
  }
}

/**
 * Every item id the library holds, read outside the delta feed: folders from
 * the directory table, files from each folder's own listing. Items name files
 * by stack id, which library rows do not carry, so the library's own count
 * checks the listings missed nothing.
 */
export async function libraryItemIds(host: ProviderFeedHost): Promise<Set<string>> {
  const ids = new Set<string>()
  const folders: (string | null)[] = [null]
  for (const dir of await host.app.directories.getAll()) {
    ids.add(directoryProviderId(dir.id))
    folders.push(directoryProviderId(dir.id))
  }
  let listedFiles = 0
  for (const folder of folders) {
    for (const item of (await drainListing(host, folder)).items) {
      if (item.kind !== 'file') continue
      ids.add(item.id)
      listedFiles += 1
    }
  }
  expect(listedFiles).toBe((await host.app.files.queryLibrary({ limit: 100000 })).length)
  return ids
}

/**
 * Drains a fresh working-set listing plus its deltas and asserts the result
 * matches what the library actually contains. Wired into suite teardowns so
 * every flow already written exercises the feed's triggers.
 */
export async function assertFeedConverges(host: ProviderFeedHost): Promise<void> {
  const listed = await drainListing(host, WORKING_SET_ID)
  const mirror = new Set(listed.items.map((item) => item.id))
  let anchor = listed.anchor
  let hasMore = true
  while (hasMore) {
    const page = await host.app.provider.changes(WORKING_SET_ID, anchor)
    if (page.expired) throw new Error('the feed expired during teardown convergence')
    for (const item of page.items) mirror.add(item.id)
    for (const id of page.deletedIds) mirror.delete(id)
    anchor = page.anchor
    hasMore = page.hasMore
  }
  const expected = await libraryItemIds(host)
  expect([...mirror].sort()).toEqual([...expected].sort())
}
