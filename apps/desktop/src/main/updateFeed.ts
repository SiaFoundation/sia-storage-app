/*
 * Which release, if any, an installed build should update to.
 *
 * The feed is the repository's GitHub releases. Every package in the monorepo
 * releases there, so desktop releases are picked out by their `desktop/v` tag,
 * and each carries one zip per build context it shipped. A stable release
 * carries a beta zip as well as the shipping one, which is what moves a beta
 * install from `1.2.0-rc.3` to `1.2.0` and on to the next train's candidates.
 * The two contexts have different bundle ids and the updater only replaces a
 * bundle with one signed under the same id, so each install reads only its
 * own context's zip.
 *
 * No Electron here, so the choice can be tested on its own.
 */

import { compareVersions, isCandidate, parseVersion } from './versions'

/** `beta` takes candidates and stable releases, `stable` takes stable ones only. */
export type UpdateChannel = 'beta' | 'stable'

/** The fields of a GitHub release this reads. */
export type FeedRelease = {
  tag_name: string
  draft: boolean
  assets: Array<{ name: string; browser_download_url: string }>
}

export type AvailableUpdate = {
  version: string
  /** The zip the updater downloads and installs. */
  url: string
}

const TAG_PREFIX = 'desktop/v'

/**
 * The newest release on `channel` that is newer than `current` and carries a
 * zip for this context, or null. A release whose build failed has no zip, so
 * it is passed over rather than offered and then failing.
 */
export function pickUpdate(
  releases: FeedRelease[],
  options: {
    channel: UpdateChannel
    /** The zip's file name with `{version}` in place of the version, as packaging wrote it. */
    asset: string
    current: string
  },
): AvailableUpdate | null {
  let update: AvailableUpdate | null = null
  for (const release of releases) {
    if (release.draft || !release.tag_name.startsWith(TAG_PREFIX)) continue
    const version = release.tag_name.slice(TAG_PREFIX.length)
    if (!parseVersion(version)) continue
    if (options.channel === 'stable' && isCandidate(version)) continue
    if (compareVersions(version, update?.version ?? options.current) <= 0) continue
    const name = options.asset.replace('{version}', version)
    const asset = release.assets.find((a) => a.name === name)
    if (!asset) continue
    update = { version, url: asset.browser_download_url }
  }
  return update
}
