#!/usr/bin/env bun

/**
 * Checks the files in each app's release-notes/ in CI. Every PR checks their
 * shape and the store length limits. A release PR (RELEASE_BRANCH set to its
 * branch) must also carry its app's notes: a candidate PR the What's New
 * entry and tester notes for the version it cuts, so it cannot merge while
 * Prepare Release failed to write them, and a final PR the dated entry it
 * releases.
 */

import { releaseBranch } from '../../../scripts/release-trains'
import {
  APP_NAMES,
  type AppName,
  isCandidate,
  marketingVersion,
  packageVersion,
  readTesting,
  readWhatsNew,
  storeLimit,
  storeText,
} from './releaseNotes'

function releasePrProblems(app: AppName, final: boolean): string[] {
  const version = packageVersion(app)
  const marketing = marketingVersion(version)
  const entry = readWhatsNew(app).find((e) => e.version === marketing)
  if (!final) {
    if (!isCandidate(version)) return [`${app} ${version} is not a candidate version`]
    const testing = readTesting(app)
    return [
      ...(testing.version === version
        ? []
        : [`${app}'s testing.json is for ${testing.version}, not ${version}`]),
      ...(entry ? [] : [`${app}'s whats-new.json has no entry for ${marketing}`]),
    ]
  }
  if (isCandidate(version)) return [`${app} ${version} is not a stable version`]
  // Only mobile's entry is required, because the store submission sends it.
  if (!entry) return app === 'mobile' ? [`mobile's whats-new.json has no entry for ${version}`] : []
  return entry.released ? [] : [`${app} ${version} has no released date`]
}

function problems(): string[] {
  const found: string[] = []
  for (const app of APP_NAMES) readTesting(app)
  for (const entry of readWhatsNew('mobile')) {
    for (const platform of ['ios', 'android'] as const) {
      const length = storeText(entry, platform).length
      if (length > storeLimit(platform)) {
        found.push(
          `${entry.version}: the ${platform} notes are ${length} characters, over ${storeLimit(platform)}`,
        )
      }
    }
  }
  const branch = releaseBranch(process.env.RELEASE_BRANCH ?? '')
  if (branch?.train.app) found.push(...releasePrProblems(branch.train.app, branch.final))
  return found
}

const found = problems()
if (found.length > 0) {
  console.error(
    `The release notes need fixing. Re-run Prepare Release, or edit the files on the release branch:\n${found.map((p) => `- ${p}`).join('\n')}`,
  )
  process.exit(1)
}
console.log('release notes ok')
