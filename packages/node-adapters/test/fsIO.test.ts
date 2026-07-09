import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { createNodeFsIO } from '../src/fsIO'

let filesDir: string
let fsIO: ReturnType<typeof createNodeFsIO>

beforeEach(() => {
  filesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-fsio-test-'))
  fsIO = createNodeFsIO(filesDir)
})

afterEach(() => {
  fs.rmSync(filesDir, { recursive: true, force: true })
})

describe('uri', () => {
  it('returns correct path with extension from MIME type', () => {
    const uri = fsIO.uri('abc123', 'image/jpeg')
    expect(uri).toBe(path.join(filesDir, 'abc123.jpg'))
  })

  it('handles unknown MIME type', () => {
    const uri = fsIO.uri('abc123', 'application/octet-stream')
    expect(uri).toContain('abc123')
  })
})

describe('size', () => {
  it('returns file size for existing file', async () => {
    const filePath = path.join(filesDir, 'abc123.jpg')
    fs.writeFileSync(filePath, 'hello')
    const result = await fsIO.size('abc123', 'image/jpeg')
    expect(result).toEqual({ value: 5 })
  })

  it('returns not_found for missing file', async () => {
    const result = await fsIO.size('missing', 'image/jpeg')
    expect(result).toEqual({ value: null, error: 'not_found' })
  })
})

describe('remove', () => {
  it('deletes file', async () => {
    const filePath = path.join(filesDir, 'abc123.jpg')
    fs.writeFileSync(filePath, 'data')
    await fsIO.remove('abc123', 'image/jpeg')
    expect(fs.existsSync(filePath)).toBe(false)
  })

  it('does not throw for missing file', async () => {
    await expect(fsIO.remove('missing', 'image/jpeg')).resolves.not.toThrow()
  })
})

describe('copy', () => {
  it('copies file and returns correct URI and size', async () => {
    const sourceFile = path.join(filesDir, 'source.tmp')
    fs.writeFileSync(sourceFile, 'copy me')
    const result = await fsIO.copy({ id: 'dest', type: 'image/png' }, sourceFile)
    expect(result.size).toBe(7)
    expect(result.uri).toBe(path.join(filesDir, 'dest.png'))
    expect(fs.readFileSync(result.uri, 'utf-8')).toBe('copy me')
  })
})

describe('writeFile', () => {
  it('writes ArrayBuffer data and returns correct URI and size', async () => {
    const data = new TextEncoder().encode('hello world').buffer as ArrayBuffer
    const result = await fsIO.writeFile!({ id: 'written', type: 'image/jpeg' }, data)
    expect(result.size).toBe(11)
    expect(result.uri).toBe(path.join(filesDir, 'written.jpg'))
    expect(fs.readFileSync(result.uri, 'utf-8')).toBe('hello world')
  })
})

describe('list', () => {
  it('returns filenames in directory', async () => {
    fs.writeFileSync(path.join(filesDir, 'a.jpg'), '')
    fs.writeFileSync(path.join(filesDir, 'b.png'), '')
    const files = await fsIO.list()
    expect(files.sort()).toEqual(['a.jpg', 'b.png'])
  })

  it('returns empty array for missing directory', async () => {
    const emptyFsIO = createNodeFsIO(path.join(filesDir, 'nonexistent'))
    const files = await emptyFsIO.list()
    expect(files).toEqual([])
  })
})

describe('getDeviceSpace', () => {
  it('returns positive free + total bytes with free <= total', async () => {
    const space = await fsIO.getDeviceSpace!()
    expect(space.freeBytes).toBeGreaterThan(0)
    expect(space.totalBytes).toBeGreaterThan(0)
    expect(space.freeBytes).toBeLessThanOrEqual(space.totalBytes)
  })
})

describe('ensureDirectory', () => {
  it('creates directory recursively', async () => {
    const nestedDir = path.join(filesDir, 'a', 'b', 'c')
    const nestedFsIO = createNodeFsIO(nestedDir)
    await nestedFsIO.ensureDirectory()
    expect(fs.existsSync(nestedDir)).toBe(true)
  })

  it('is idempotent', async () => {
    await fsIO.ensureDirectory()
    await fsIO.ensureDirectory()
    expect(fs.existsSync(filesDir)).toBe(true)
  })
})
