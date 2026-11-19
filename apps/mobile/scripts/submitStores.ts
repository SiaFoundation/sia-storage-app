#!/usr/bin/env bun

/**
 * Submits a stable mobile release to App Store or Google Play review, using
 * the build of the release candidate it graduated rather than a new one. The
 * candidate is the `mobile/vX.Y.Z-rc.N` tag on the stable tag's commit, its
 * build number comes from appVersion.js, and the notes are that version's
 * entry in release-notes/whats-new.json.
 *
 * Every run reads what the store already has first, so a re-run after a
 * failure, or of a run that finished, does only what is left.
 *
 * Usage:
 *   bun scripts/submitStores.ts <ios|android> <X.Y.Z> [--dry-run]
 */

import { execFileSync } from 'node:child_process'
import { deriveAppVersion } from '../appVersion'
import { resolveVariant } from '../variants'
import { type Platform, readWhatsNew, storeLimit, storeText } from './releaseNotes'
import { submitToAppStore } from './stores/appStore'
import { submitToGooglePlay } from './stores/googlePlay'

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf-8' }).trim()
}

/** The newest release candidate tagged on the same commit as the stable tag. */
export function shippedCandidate(version: string): string {
  const commit = git('rev-list', '-n', '1', `mobile/v${version}`)
  const candidates = git('tag', '--points-at', commit, '--list', `mobile/v${version}-rc.*`)
    .split('\n')
    .filter(Boolean)
    .map((tag) => tag.replace('mobile/v', ''))
    .sort((a, b) => Number(a.split('-rc.')[1]) - Number(b.split('-rc.')[1]))
  const candidate = candidates.at(-1)
  if (!candidate) throw new Error(`mobile/v${version} is not on a release candidate's commit`)
  return candidate
}

function notes(version: string, platform: Platform): string {
  const entry = readWhatsNew().find((e) => e.version === version)
  if (!entry) throw new Error(`release-notes/whats-new.json has no entry for ${version}`)
  const text = storeText(entry, platform)
  if (!text) throw new Error(`the ${version} entry has no items for ${platform}`)
  if (text.length > storeLimit(platform)) {
    throw new Error(
      `the ${platform} notes are ${text.length} characters, over ${storeLimit(platform)}`,
    )
  }
  return text
}

async function main(): Promise<void> {
  const [platform, version] = Bun.argv.slice(2)
  const dryRun = Bun.argv.includes('--dry-run')
  if ((platform !== 'ios' && platform !== 'android') || !/^\d+\.\d+\.\d+$/.test(version ?? '')) {
    throw new Error('usage: bun scripts/submitStores.ts <ios|android> <X.Y.Z> [--dry-run]')
  }
  const candidate = shippedCandidate(version)
  const { buildNumber } = deriveAppVersion(candidate)
  const whatsNew = notes(version, platform)
  // The beta app is never submitted, so the identity is fixed to prod here.
  const { bundleId } = resolveVariant('prod')
  console.log(
    `${platform}: ${version} from ${candidate}, build ${buildNumber}${dryRun ? ' (dry run)' : ''}`,
  )

  if (platform === 'ios') {
    await submitToAppStore({ bundleId, version, buildNumber, whatsNew, dryRun })
  } else {
    await submitToGooglePlay({
      packageName: bundleId,
      version,
      versionCode: buildNumber,
      whatsNew,
      dryRun,
    })
  }
}

if (import.meta.main) await main()
