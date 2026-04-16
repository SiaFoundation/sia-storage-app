import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { createNodeUploaderAdapters } from '../src/uploader'

let tempDir: string

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-uploader-test-'))
})

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe('createFileReader', () => {
  const adapters = createNodeUploaderAdapters()

  it('reads small file completely', async () => {
    const filePath = path.join(tempDir, 'small.txt')
    const content = 'hello world'
    fs.writeFileSync(filePath, content)

    const reader = adapters.createFileReader(filePath)
    const chunks: ArrayBuffer[] = []
    let chunk = await reader.read()
    while (chunk.byteLength > 0) {
      chunks.push(chunk)
      chunk = await reader.read()
    }

    const combined = Buffer.concat(chunks.map((c) => Buffer.from(c)))
    expect(combined.toString()).toBe(content)
  })

  it('reads large file in chunks', async () => {
    const filePath = path.join(tempDir, 'large.bin')
    const size = 256 * 1024 // 256KB, larger than 64KB chunk size
    const data = Buffer.alloc(size, 0xab)
    fs.writeFileSync(filePath, data)

    const reader = adapters.createFileReader(filePath)
    const chunks: ArrayBuffer[] = []
    let chunk = await reader.read()
    while (chunk.byteLength > 0) {
      chunks.push(chunk)
      chunk = await reader.read()
    }

    expect(chunks.length).toBeGreaterThan(1)
    const combined = Buffer.concat(chunks.map((c) => Buffer.from(c)))
    expect(combined.length).toBe(size)
    expect(combined.equals(data)).toBe(true)
  })

  it('returns empty ArrayBuffer on EOF', async () => {
    const filePath = path.join(tempDir, 'eof.txt')
    fs.writeFileSync(filePath, 'x')

    const reader = adapters.createFileReader(filePath)
    await reader.read() // content
    const eof = await reader.read()
    expect(eof.byteLength).toBe(0)
  })

  it('handles empty file', async () => {
    const filePath = path.join(tempDir, 'empty.txt')
    fs.writeFileSync(filePath, '')

    const reader = adapters.createFileReader(filePath)
    const chunk = await reader.read()
    expect(chunk.byteLength).toBe(0)
  })

  it('handles file:// prefix', async () => {
    const filePath = path.join(tempDir, 'prefixed.txt')
    fs.writeFileSync(filePath, 'data')

    const reader = adapters.createFileReader(`file://${filePath}`)
    const chunk = await reader.read()
    expect(Buffer.from(chunk).toString()).toBe('data')
  })
})

describe('progressScheduler', () => {
  it('calls callback asynchronously', async () => {
    const adapters = createNodeUploaderAdapters()
    let called = false
    adapters.progressScheduler!(() => {
      called = true
    })
    expect(called).toBe(false)
    await new Promise((r) => setTimeout(r, 10))
    expect(called).toBe(true)
  })
})
