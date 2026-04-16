import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { createInMemoryStorage, createJsonFileStorage } from '../src/storage'

describe('createInMemoryStorage', () => {
  it('returns null for missing keys', async () => {
    const storage = createInMemoryStorage()
    expect(await storage.getItem('missing')).toBeNull()
  })

  it('sets and gets items', async () => {
    const storage = createInMemoryStorage()
    await storage.setItem('key', 'value')
    expect(await storage.getItem('key')).toBe('value')
  })

  it('deletes items', async () => {
    const storage = createInMemoryStorage()
    await storage.setItem('key', 'value')
    await storage.deleteItem('key')
    expect(await storage.getItem('key')).toBeNull()
  })
})

describe('createJsonFileStorage', () => {
  let tempDir: string
  let storagePath: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-storage-test-'))
    storagePath = path.join(tempDir, 'storage.json')
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('returns null for missing keys', async () => {
    const storage = createJsonFileStorage(storagePath)
    expect(await storage.getItem('missing')).toBeNull()
  })

  it('sets and gets an item', async () => {
    const storage = createJsonFileStorage(storagePath)
    await storage.setItem('key', 'value')
    expect(await storage.getItem('key')).toBe('value')
  })

  it('overwrites an existing item', async () => {
    const storage = createJsonFileStorage(storagePath)
    await storage.setItem('key', 'first')
    await storage.setItem('key', 'second')
    expect(await storage.getItem('key')).toBe('second')
  })

  it('deletes an item', async () => {
    const storage = createJsonFileStorage(storagePath)
    await storage.setItem('key', 'value')
    await storage.deleteItem('key')
    expect(await storage.getItem('key')).toBeNull()
  })

  it('persists across instances', async () => {
    const storage1 = createJsonFileStorage(storagePath)
    await storage1.setItem('persist', 'yes')

    const storage2 = createJsonFileStorage(storagePath)
    expect(await storage2.getItem('persist')).toBe('yes')
  })

  it('handles multiple keys', async () => {
    const storage = createJsonFileStorage(storagePath)
    await storage.setItem('a', '1')
    await storage.setItem('b', '2')
    await storage.setItem('c', '3')
    expect(await storage.getItem('a')).toBe('1')
    expect(await storage.getItem('b')).toBe('2')
    expect(await storage.getItem('c')).toBe('3')
  })

  it('handles missing file gracefully', async () => {
    const storage = createJsonFileStorage(path.join(tempDir, 'nonexistent.json'))
    expect(await storage.getItem('key')).toBeNull()
    await storage.setItem('key', 'value')
    expect(await storage.getItem('key')).toBe('value')
  })

  it('handles corrupt JSON file gracefully', async () => {
    fs.writeFileSync(storagePath, 'not json{{{')
    const storage = createJsonFileStorage(storagePath)
    expect(await storage.getItem('key')).toBeNull()
    await storage.setItem('key', 'value')
    expect(await storage.getItem('key')).toBe('value')
  })

  it('respects file mode option', async () => {
    const storage = createJsonFileStorage(storagePath, { mode: 0o600 })
    await storage.setItem('secret', 'value')
    const stat = fs.statSync(storagePath)
    // eslint-disable-next-line no-bitwise
    const mode = stat.mode & 0o777
    expect(mode).toBe(0o600)
  })

  it('creates parent directory if it does not exist', async () => {
    const nested = path.join(tempDir, 'a', 'b', 'storage.json')
    const storage = createJsonFileStorage(nested)
    await storage.setItem('key', 'value')
    expect(fs.existsSync(nested)).toBe(true)
    expect(await storage.getItem('key')).toBe('value')
  })
})
