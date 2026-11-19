#!/usr/bin/env bun

/**
 * iOS Release Build & Distribution
 *
 * Builds a signed iOS IPA and uploads it to TestFlight, with the tester notes
 * from release-notes/testing.json as "What to Test". The App Store gets the
 * same build later, through submitStores.ts.
 *
 * Usage:
 *   bun scripts/releaseIos.ts
 *
 * Environment variables:
 *   APP_VARIANT                    - Which app to build: beta | prod (default prod)
 *   APPLE_TEAM_ID                  - Apple Developer Team ID
 *   APP_STORE_CONNECT_API_KEY_JSON - App Store Connect API key
 */

import path from 'node:path'
import { $ } from 'bun'
import pkg from '../package.json'
import { resolveVariant } from '../variants'
import { testerText } from './releaseNotes'

const projectRoot = path.resolve(import.meta.dir, '..')

// Which app identity to build. CI sets APP_VARIANT per matrix leg; default to
// prod so a bare `release:ios:*` invocation builds the public app.
const variant = resolveVariant(Bun.env.APP_VARIANT || 'prod')

// Verify required environment variables
const requiredVars = ['APPLE_TEAM_ID', 'APP_STORE_CONNECT_API_KEY_JSON']

const missingVars = requiredVars.filter((v) => !Bun.env[v])
if (missingVars.length > 0) {
  console.error('Error: Missing required environment variables:')
  missingVars.forEach((v) => console.error(`  - ${v}`))
  process.exit(1)
}

// Export the resolved identity so `expo prebuild` (app.config.js) and Fastlane
// (Appfile + build_ipa) all target the same app. variants.js is the one source
// of truth for these values.
process.env.APP_VARIANT = variant.key
process.env.IOS_PROJECT_NAME = variant.xcodeName
process.env.IOS_BUNDLE_ID = variant.bundleId
process.env.IOS_SHARE_EXTENSION_BUNDLE_ID = variant.shareExtBundleId
process.env.IOS_PROFILE_NAME = variant.iosProfileName
process.env.IOS_SHARE_EXTENSION_PROFILE_NAME = variant.shareExtProfileName

$.cwd(projectRoot)

console.log(`=== iOS Release Build (${variant.name}) ===`)

// Step 1: Clean and prebuild
console.log('Step 1/3: Cleaning and prebuilding...')
await $`bunx rimraf .expo ios`
await $`bunx expo prebuild --platform ios`

// Step 2: Build IPA
console.log('Step 2/3: Building release IPA...')
await $`fastlane ios build_ipa`

// Step 3: Upload to TestFlight
if (Bun.env.DRY_RUN === 'true') {
  console.log('Step 3/3: DRY_RUN=true, skipping the TestFlight upload.')
} else {
  console.log('Step 3/3: Uploading to TestFlight...')
  // Fastfile reads both via ENV: the "What to Test" text and the variant's
  // external tester groups.
  process.env.IOS_WHATS_NEW = testerText(pkg.version, 'ios')
  process.env.IOS_EXTERNAL_GROUPS = JSON.stringify(variant.testflightExternalGroups)
  await $`fastlane ios distribute_testflight`
}

console.log('=== iOS release complete! ===')
