import type { ShareLinkFile } from '../types/shareLinks'
import {
  expiresAt,
  expiryLabel,
  linkProgress,
  linkTitle,
  modeLabel,
  shareErrorText,
} from './shareLinkText'

const file = (name: string, state: ShareLinkFile['state'] = 'shared'): ShareLinkFile => ({
  fileId: name,
  name,
  size: 1,
  folder: null,
  state,
})

const DAY = 24 * 60 * 60 * 1000

describe('share links', () => {
  it('a link is named by its first file and how many more it holds', () => {
    expect(linkTitle({ files: [file('a.jpg')] })).toBe('a.jpg')
    expect(linkTitle({ files: [file('a.jpg'), file('b.jpg'), file('c.jpg')] })).toBe(
      'a.jpg and 2 more',
    )
    expect(linkTitle({ files: [] })).toBe('No files')
  })

  it('a new link expires the chosen time from now, or never', () => {
    expect(expiresAt('day', 1_000)).toBe(1_000 + DAY)
    expect(expiresAt('month', 0)).toBe(30 * DAY)
    expect(expiresAt('never', 1_000)).toBeNull()
  })

  it('the time left is given in hours under a day and in days after', () => {
    expect(expiryLabel(null, 0)).toBe('Never expires')
    expect(expiryLabel(60 * 60 * 1000, 0)).toBe('Expires in 1 hour')
    expect(expiryLabel(5 * 60 * 60 * 1000, 0)).toBe('Expires in 5 hours')
    expect(expiryLabel(7 * DAY, 0)).toBe('Expires in 7 days')
    expect(expiryLabel(0, 1)).toBe('Expired')
  })

  it("a link's mode is named by what it shows", () => {
    expect(modeLabel('latest')).toBe('Latest versions')
    expect(modeLabel('snapshot')).toBe('These versions')
  })

  it('files still uploading or in the trash are named, and a link with neither says nothing', () => {
    expect(linkProgress({ files: [file('a'), file('b')] })).toBeNull()
    expect(linkProgress({ files: [file('a', 'pending'), file('b', 'trashed')] })).toBe(
      '1 file uploading, 1 file in the trash',
    )
  })

  it('a failed change shows the core message inside the transport text, and nothing else', () => {
    const wrapped = new Error(
      "Error invoking remote method 'rpc': RpcError: None of these files can be shared",
    )
    const internal = new Error(
      'ds:shares:revokeLink: connect ECONNREFUSED https://user:pw@indexer.example/api',
    )

    expect(shareErrorText(wrapped, 'Could not make the link.')).toBe(
      'None of these files can be shared',
    )
    expect(shareErrorText(internal, 'Could not revoke the link.')).toBe(
      'Could not revoke the link.',
    )
    expect(shareErrorText('not an error', 'Could not revoke the link.')).toBe(
      'Could not revoke the link.',
    )
  })
})
