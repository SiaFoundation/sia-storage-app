#!/usr/bin/env bun

/**
 * Sends a mobile release candidate's build to the stores, without building
 * anything. Release already uploaded the candidate's prod build to TestFlight
 * and Play internal testing, so the stores review the binary testers ran.
 *
 * - `submit` puts the candidate's build under its plain X.Y.Z version in App
 *   Store or Google Play review, with the What's New entry the candidate
 *   carries. Finalize Release runs it.
 * - `release` releases the App Store version the stable tag `mobile/vX.Y.Z`
 *   names, once Apple has approved it. The stable tag's publication runs it.
 *   Google Play has no API to publish an update managed publishing holds, so
 *   that is done in Play Console.
 *
 * Every run reads what the store already has first, so a re-run after a
 * failure, or of a run that finished, does only what is left. Only states and
 * versions are printed, never what a store's API returns.
 *
 * Usage:
 *   bun scripts/submitStores.ts submit <ios|android> <mobile/vX.Y.Z-rc.N> [--dry-run]
 *   bun scripts/submitStores.ts release ios <X.Y.Z> [--dry-run]
 */

import { execFileSync } from 'node:child_process'
import { parseCandidateTag } from '../../../scripts/release-trains'
import { deriveAppVersion } from '../appVersion'
import { resolveVariant } from '../variants'
import {
  type MobilePlatform,
  marketingVersion,
  parseWhatsNew,
  storeLimit,
  storeText,
} from './releaseNotes'
import { type AppStoreBuild, releaseOnAppStore, submitToAppStore } from './stores/appStore'
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

/** The prod app's build of a candidate version. The beta app is never submitted. */
export function buildOf(candidate: string): AppStoreBuild {
  return {
    bundleId: resolveVariant('prod').bundleId,
    version: marketingVersion(candidate),
    buildNumber: deriveAppVersion(candidate).buildNumber,
  }
}

/**
 * The store text from the What's New entry in the candidate's own commit. Main
 * may already hold a later candidate's entry for the same version, with
 * changes this build doesn't have.
 */
function notesAt(tag: string, version: string, platform: MobilePlatform): string {
  const file = 'apps/mobile/release-notes/whats-new.json'
  const entries = parseWhatsNew(JSON.parse(git('show', `${tag}:${file}`)), 'mobile', file)
  const entry = entries.find((e) => e.version === version)
  if (!entry) throw new Error(`${tag} has no What's New entry for ${version}`)
  const text = storeText(entry, platform)
  if (text.length > storeLimit(platform)) {
    throw new Error(
      `the ${platform} notes are ${text.length} characters, over ${storeLimit(platform)}`,
    )
  }
  return text
}

async function submit(platform: MobilePlatform, tag: string, dryRun: boolean): Promise<void> {
  const candidate = parseCandidateTag(tag)
  if (candidate?.app !== 'mobile') throw new Error(`${tag} is not a mobile candidate tag`)
  const build = buildOf(candidate.version)
  const whatsNew = notesAt(tag, build.version, platform)
  console.log(
    `${platform}: submitting ${build.version} from ${candidate.version}, build ${build.buildNumber}${dryRun ? ' (dry run)' : ''}`,
  )
  if (platform === 'ios') {
    await submitToAppStore({ ...build, whatsNew, dryRun })
  } else {
    await submitToGooglePlay({
      packageName: build.bundleId,
      version: build.version,
      versionCode: build.buildNumber,
      whatsNew,
      dryRun,
    })
  }
}

async function release(version: string, dryRun: boolean): Promise<void> {
  const candidate = shippedCandidate(version)
  const build = buildOf(candidate)
  console.log(
    `ios: releasing ${version} from ${candidate}, build ${build.buildNumber}${dryRun ? ' (dry run)' : ''}`,
  )
  await releaseOnAppStore({ ...build, dryRun })
}

const USAGE = `usage:
  bun scripts/submitStores.ts submit <ios|android> <mobile/vX.Y.Z-rc.N> [--dry-run]
  bun scripts/submitStores.ts release ios <X.Y.Z> [--dry-run]`

export type Command =
  | { kind: 'submit'; platform: MobilePlatform; tag: string }
  | { kind: 'release'; platform: MobilePlatform; version: string }

const STABLE = /^\d+\.\d+\.\d+$/

/**
 * The command in `args`.
 *
 * Transition: `<ios|android> <X.Y.Z>` is the form the Release Stores workflow
 * of mobile 1.15.1-rc.3, the last candidate cut before Finalize Release
 * submitted to the stores, runs when its stable tag is published, since a
 * release event runs the workflow of the tagged commit. It means releasing
 * the approved version. Remove it once 1.15.1 is released.
 */
export function parseCommand(args: string[]): Command {
  const [command, platform, target] = args.filter((a) => a !== '--dry-run')
  const mobile = (p: string | undefined): p is MobilePlatform => p === 'ios' || p === 'android'
  if (command === 'submit' && mobile(platform) && target)
    return { kind: 'submit', platform, tag: target }
  if (command === 'release' && platform === 'ios' && STABLE.test(target ?? '')) {
    return { kind: 'release', platform, version: target ?? '' }
  }
  if (mobile(command) && STABLE.test(platform ?? '')) {
    return { kind: 'release', platform: command, version: platform ?? '' }
  }
  throw new Error(USAGE)
}

async function main(): Promise<void> {
  const args = Bun.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const command = parseCommand(args)
  if (command.kind === 'submit') {
    await submit(command.platform, command.tag, dryRun)
  } else if (command.platform === 'ios') {
    await release(command.version, dryRun)
  } else {
    // Google Play's API can't publish an update managed publishing holds.
    console.log(`android: publish ${command.version} in Play Console once Google approves it`)
  }
}

if (import.meta.main) await main()
