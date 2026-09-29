import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { createNodeDetectMimeType } from '../src/detectMimeType'

let tempDir: string
let detect: ReturnType<typeof createNodeDetectMimeType>

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sia-mime-test-'))
  detect = createNodeDetectMimeType()
})

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe('createNodeDetectMimeType', () => {
  it('reads the extension from the name it is given over the path', async () => {
    const staged = path.join(tempDir, '6f1c2b0e')
    fs.writeFileSync(staged, 'plain notes')
    expect(await detect(staged)).toBeNull()
    expect(await detect(staged, 'notes.md')).toBe('text/markdown')
  })

  it('lets the bytes win over the name it is given', async () => {
    const staged = path.join(tempDir, '6f1c2b0e')
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    fs.writeFileSync(staged, Buffer.concat([png, Buffer.alloc(100)]))
    expect(await detect(staged, 'picture.txt')).toBe('image/png')
  })

  it('does not read through a symlink, and answers from the name', async () => {
    const png = path.join(tempDir, 'real.png')
    fs.writeFileSync(
      png,
      Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.alloc(100),
      ]),
    )
    const staged = path.join(tempDir, '6f1c2b0e')
    fs.symlinkSync(png, staged)
    expect(await detect(staged, 'notes.md')).toBe('text/markdown')
  })

  it('detects PNG file correctly', async () => {
    const filePath = path.join(tempDir, 'test.png')
    // PNG magic bytes
    const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    fs.writeFileSync(filePath, Buffer.concat([header, Buffer.alloc(100)]))
    const result = await detect(filePath)
    expect(result).toBe('image/png')
  })

  it('detects JPEG file correctly', async () => {
    const filePath = path.join(tempDir, 'test.jpg')
    // JPEG magic bytes
    const header = Buffer.from([0xff, 0xd8, 0xff, 0xe0])
    fs.writeFileSync(filePath, Buffer.concat([header, Buffer.alloc(100)]))
    const result = await detect(filePath)
    expect(result).toBe('image/jpeg')
  })

  it('returns null for unknown binary', async () => {
    const filePath = path.join(tempDir, 'test.bin')
    fs.writeFileSync(filePath, Buffer.alloc(100, 0x00))
    const result = await detect(filePath)
    expect(result).toBeNull()
  })

  it('falls back to extension when magic bytes inconclusive', async () => {
    const filePath = path.join(tempDir, 'test.mp4')
    fs.writeFileSync(filePath, Buffer.alloc(10, 0x00))
    const result = await detect(filePath)
    expect(result).toBe('video/mp4')
  })

  it('handles file:// prefix', async () => {
    const filePath = path.join(tempDir, 'test.jpg')
    const header = Buffer.from([0xff, 0xd8, 0xff, 0xe0])
    fs.writeFileSync(filePath, Buffer.concat([header, Buffer.alloc(100)]))
    const result = await detect(`file://${filePath}`)
    expect(result).toBe('image/jpeg')
  })
})
