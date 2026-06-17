#!/usr/bin/env bun

/**
 * iOS Release Build & Distribution
 *
 * Builds a signed iOS IPA and uploads to App Store Connect.
 *
 * Usage:
 *   bun scripts/releaseIos.ts [testflight|appstore]
 *
 * Environment variables:
 *   APP_VARIANT                    - Which app to build: beta | prod (default prod)
 *   APPLE_TEAM_ID                  - Apple Developer Team ID
 *   APP_STORE_CONNECT_API_KEY_JSON - App Store Connect API key
 */

import path from 'node:path'
import { $ } from 'bun'
import { resolveVariant } from '../variants'

const projectRoot = path.resolve(import.meta.dir, '..')

// Get track from command line args
const track = Bun.argv[2] || 'testflight'

if (track !== 'testflight' && track !== 'appstore') {
  console.error('Usage: bun scripts/releaseIos.ts [testflight|appstore]')
  console.error('  testflight - Upload to TestFlight (default)')
  console.error('  appstore   - Upload to App Store')
  process.exit(1)
}

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
process.env.IOS_BUNDLE_ID = variant.bundleId
process.env.IOS_SHARE_EXTENSION_BUNDLE_ID = variant.shareExtBundleId
process.env.IOS_PROFILE_NAME = variant.iosProfileName
process.env.IOS_SHARE_EXTENSION_PROFILE_NAME = variant.shareExtProfileName

$.cwd(projectRoot)

console.log(`=== iOS Release Build (${variant.name} / ${track}) ===`)

// Step 1: Clean and prebuild
console.log('Step 1/3: Cleaning and prebuilding...')
await $`bunx rimraf .expo ios`
await $`bunx expo prebuild --platform ios`

// Step 2: Build IPA
console.log('Step 2/3: Building release IPA...')
await $`fastlane ios build_ipa`

// Step 3: Upload to App Store Connect
if (Bun.env.DRY_RUN === 'true') {
  console.log('Step 3/3: DRY_RUN=true — skipping App Store Connect upload.')
} else {
  console.log(`Step 3/3: Uploading to App Store Connect (${track})...`)
  if (track === 'testflight') {
    await $`fastlane ios distribute_testflight`
  } else {
    await $`fastlane ios distribute_app_store`
  }
}

console.log('=== iOS release complete! ===')
