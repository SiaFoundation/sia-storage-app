import { fileUriToPath } from './fileUri'

describe('fileUriToPath', () => {
  it('strips the file:// scheme and keeps the leading slash', () => {
    expect(fileUriToPath('file:///var/mobile/Containers/photo.jpg')).toBe(
      '/var/mobile/Containers/photo.jpg',
    )
  })

  it('decodes escapes so a name with a space opens', () => {
    expect(fileUriToPath('file:///tmp/My%20Photo.jpg')).toBe('/tmp/My Photo.jpg')
    expect(fileUriToPath('file:///tmp/a%23b%2Bc.png')).toBe('/tmp/a#b+c.png')
  })

  it('returns a path that is already bare unchanged', () => {
    expect(fileUriToPath('/tmp/plain.txt')).toBe('/tmp/plain.txt')
  })

  it('leaves non-file schemes alone', () => {
    expect(fileUriToPath('ph://ABC-123')).toBe('ph://ABC-123')
    expect(fileUriToPath('content://media/external/images/1')).toBe(
      'content://media/external/images/1',
    )
  })
})
