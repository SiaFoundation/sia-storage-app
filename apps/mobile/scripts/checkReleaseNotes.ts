#!/usr/bin/env bun

/**
 * Checks the files in release-notes/ in CI. Every PR checks their shape and the
 * store length limits. The release PR (RELEASE_PR=true) must also carry the
 * What's New entry and tester notes for every app it releases a candidate of,
 * so it cannot merge while Prepare Release failed to write them or they were
 * written for another version, and a final must date them.
 */

import {
  APP_NAMES,
  isCandidate,
  marketingVersion,
  packageVersion,
  readTesting,
  readWhatsNew,
  storeLimit,
  storeText,
} from './releaseNotes'

function problems(): string[] {
  const found: string[] = []
  const whatsNew = { mobile: readWhatsNew('mobile'), desktop: readWhatsNew('desktop') }
  const testing = readTesting()
  for (const entry of whatsNew.mobile) {
    for (const platform of ['ios', 'android'] as const) {
      const length = storeText(entry, platform).length
      if (length > storeLimit(platform)) {
        found.push(
          `${entry.version}: the ${platform} notes are ${length} characters, over ${storeLimit(platform)}`,
        )
      }
    }
  }
  if (process.env.RELEASE_PR !== 'true') return found

  for (const app of APP_NAMES) {
    const version = packageVersion(app)
    const marketing = marketingVersion(version)
    const entry = whatsNew[app].find((e) => e.version === marketing)
    if (isCandidate(version)) {
      if (testing[app]?.version !== version) {
        found.push(`testing.json has ${app} ${testing[app]?.version ?? 'missing'}, not ${version}`)
      }
      if (!entry) found.push(`${app}'s whats-new.json has no entry for ${marketing}`)
    } else if (entry && !entry.released) {
      found.push(`${app} ${version} has no released date`)
    } else if (!entry && app === 'mobile') {
      // The store submission sends this entry.
      found.push(`mobile's whats-new.json has no entry for ${version}`)
    }
  }
  return found
}

const found = problems()
if (found.length > 0) {
  console.error(
    `apps/mobile/release-notes needs fixing. Re-run Prepare Release, or edit the files on the release branch:\n${found.map((p) => `- ${p}`).join('\n')}`,
  )
  process.exit(1)
}
console.log('release notes ok')
