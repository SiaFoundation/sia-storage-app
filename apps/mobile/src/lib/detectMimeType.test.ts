import { detectMimeType } from './detectMimeType'
import * as fileBytes from './readFileBytes'

const PNG = new Uint8Array(32)
PNG.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const TEXT = new TextEncoder().encode('plain notes')

describe('detectMimeType', () => {
  // The module is already loaded by the test setup, so its import is spied on
  // rather than replaced with jest.mock.
  const read = jest.spyOn(fileBytes, 'readFileBytes')

  afterAll(() => read.mockRestore())

  it('answers from the bytes alone when no name is given', async () => {
    read.mockResolvedValueOnce(PNG)
    expect(await detectMimeType('file:///staged/6f1c2b0e')).toBe('image/png')
    read.mockResolvedValueOnce(TEXT)
    expect(await detectMimeType('file:///staged/6f1c2b0e')).toBeNull()
  })

  it('falls back to the extension of the name it is given', async () => {
    read.mockResolvedValueOnce(TEXT)
    expect(await detectMimeType('file:///staged/6f1c2b0e', 'notes.md')).toBe('text/markdown')
  })

  it('lets the bytes win over the name it is given', async () => {
    read.mockResolvedValueOnce(PNG)
    expect(await detectMimeType('file:///staged/6f1c2b0e', 'picture.txt')).toBe('image/png')
  })
})
