import type { ShareLink } from '@siastorage/core/types'
import { filesOnLink, matchLink } from '../../src/commands/share'

function link(publicKey: string): ShareLink {
  return {
    publicKey,
    url: `https://share.sia.storage/#share=${publicKey.slice(-8)}`,
    createdAt: 0,
    expiresAt: null,
    mode: 'latest',
    files: [],
  }
}

const a = link('ed25519:3f9a0c11aa')
const b = link('ed25519:3f9b77d2bb')
const links = [a, b]

describe('naming a share link', () => {
  it('takes the start of the key after its ed25519 scheme, which every key shares', () => {
    expect(matchLink(links, '3f9a')).toBe(a)
  })

  it('takes the whole key, the start of it with the scheme, or the address', () => {
    expect(matchLink(links, 'ed25519:3f9b77d2bb')).toBe(b)
    expect(matchLink(links, 'ed25519:3f9b')).toBe(b)
    expect(matchLink(links, b.url)).toBe(b)
  })

  it('refuses a start shared by two links, and one that names none', () => {
    expect(matchLink(links, '3f9')).toBe('"3f9" matches 2 links. Give more of the key.')
    expect(matchLink(links, 'ffff')).toMatch(/^No link "ffff"/)
  })
})

describe('taking files off a link', () => {
  const shared: ShareLink = {
    ...link('ed25519:aa11'),
    files: [
      { fileId: 'f-notes', name: 'notes.txt', size: 1, folder: null, state: 'shared' },
      { fileId: 'f-beach', name: 'beach.jpg', size: 1, folder: 'photos', state: 'shared' },
    ] as ShareLink['files'],
  }

  it('finds a file on the link by path or id, even one the library no longer lists, as when it is in the trash', () => {
    expect(filesOnLink(shared, ['notes.txt', 'photos/beach.jpg'])).toEqual({
      ids: ['f-notes', 'f-beach'],
      rest: [],
    })
    expect(filesOnLink(shared, ['f-beach']).ids).toEqual(['f-beach'])
  })

  it('leaves names the link does not have for the library to resolve', () => {
    expect(filesOnLink(shared, ['other.txt'])).toEqual({ ids: [], rest: ['other.txt'] })
  })
})
