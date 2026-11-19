#!/usr/bin/env bun

/**
 * Checks the files in release-notes/ in CI. Every PR checks their shape and the
 * store length limits. The release PR (RELEASE_PR=true) must also carry notes
 * for every app it releases a candidate of, so it cannot merge while Prepare
 * Release failed to write them or they were written for another version.
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
  const entries = readWhatsNew()
  const testing = readTesting()
  for (const entry of entries) {
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
    if (isCandidate(version) && testing[app]?.version !== version) {
      found.push(`testing.json has ${app} ${testing[app]?.version ?? 'missing'}, not ${version}`)
    }
  }
  const mobile = packageVersion('mobile')
  const entry = entries.find((e) => e.version === marketingVersion(mobile))
  if (!entry) found.push(`whats-new.json has no entry for ${marketingVersion(mobile)}`)
  for (const platform of ['ios', 'android'] as const) {
    if (entry && !storeText(entry, platform))
      found.push(`${entry.version} has no ${platform} items`)
  }
  if (!isCandidate(mobile) && entry && !entry.released) {
    found.push(`${mobile} has no released date`)
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
