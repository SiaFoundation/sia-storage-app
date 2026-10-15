import { describe, expect, it } from 'bun:test'
import { type FeedRelease, pickUpdate } from './updateFeed'

const BETA_ASSET = 'Sia-Storage-Beta-{version}-arm64.zip'
const PROD_ASSET = 'Sia-Storage-{version}-arm64.zip'

/** A desktop release carrying the zips a release of `version` attaches. */
function desktop(version: string, extra: Partial<FeedRelease> = {}): FeedRelease {
  const candidate = version.includes('-rc.')
  const zips = candidate
    ? [`Sia-Storage-Beta-${version}-arm64.zip`]
    : [`Sia-Storage-${version}-arm64.zip`, `Sia-Storage-Beta-${version}-arm64.zip`]
  return {
    tag_name: `desktop/v${version}`,
    draft: false,
    assets: zips.map((name) => ({ name, browser_download_url: `https://example.test/${name}` })),
    ...extra,
  }
}

function other(tag: string): FeedRelease {
  return { tag_name: tag, draft: false, assets: [] }
}

/** Newest first, the order the releases API lists them in. */
const FEED: FeedRelease[] = [
  other('mobile/v1.15.0-rc.1'),
  desktop('1.3.0-rc.1'),
  other('cli/v0.0.8-rc.0'),
  desktop('1.3.0-rc.0'),
  desktop('1.2.0'),
  other('core/v0.0.22'),
  desktop('1.2.0-rc.3'),
  desktop('1.1.0'),
]

describe('the update a beta install takes', () => {
  const beta = { channel: 'beta' as const, asset: BETA_ASSET }

  it('is the newest desktop release, candidate or stable', () => {
    expect(pickUpdate(FEED, { ...beta, current: '1.2.0-rc.3' })).toEqual({
      version: '1.3.0-rc.1',
      url: 'https://example.test/Sia-Storage-Beta-1.3.0-rc.1-arm64.zip',
    })
  })

  it('moves from the last candidate to the stable release it became', () => {
    const update = pickUpdate([desktop('1.2.0'), desktop('1.2.0-rc.3')], {
      ...beta,
      current: '1.2.0-rc.3',
    })
    expect(update?.version).toBe('1.2.0')
    expect(update?.url).toContain('Sia-Storage-Beta-1.2.0-arm64.zip')
  })

  it('is nothing when the install is already on the newest', () => {
    expect(pickUpdate(FEED, { ...beta, current: '1.3.0-rc.1' })).toBeNull()
  })
})

describe('the update a shipping install takes', () => {
  const stable = { channel: 'stable' as const, asset: PROD_ASSET }

  it('skips candidates for the newest stable release', () => {
    expect(pickUpdate(FEED, { ...stable, current: '1.1.0' })).toEqual({
      version: '1.2.0',
      url: 'https://example.test/Sia-Storage-1.2.0-arm64.zip',
    })
  })

  it('is nothing while only candidates are newer', () => {
    expect(pickUpdate(FEED, { ...stable, current: '1.2.0' })).toBeNull()
  })
})

describe('releases the updater passes over', () => {
  const beta = { channel: 'beta' as const, asset: BETA_ASSET, current: '1.0.0' }

  it('passes over a release with no zip for this app, as when its build failed', () => {
    const failed = { ...desktop('1.1.0-rc.0'), assets: [] }
    expect(pickUpdate([failed], beta)).toBeNull()
  })

  it('passes over a draft', () => {
    expect(pickUpdate([desktop('1.1.0', { draft: true })], beta)).toBeNull()
  })

  it('passes over a tag that is not a release version', () => {
    expect(pickUpdate([desktop('1.1.0-beta.1')], beta)).toBeNull()
  })

  it('never offers a version older than the one installed', () => {
    expect(pickUpdate([desktop('0.9.0')], beta)).toBeNull()
  })
})

describe('a feed listed by creation rather than by version', () => {
  it('finds a higher release listed below a backport published after it', () => {
    const feed = [desktop('1.1.1'), other('core/v0.0.30'), desktop('1.2.0')]
    const update = pickUpdate(feed, {
      channel: 'stable',
      asset: PROD_ASSET,
      current: '1.1.0',
    })
    expect(update?.version).toBe('1.2.0')
  })
})
