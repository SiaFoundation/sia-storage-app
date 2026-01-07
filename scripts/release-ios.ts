#!/usr/bin/env bun
/**
 * iOS Release Build & Upload Script
 *
 * Builds and uploads the iOS app to App Store Connect.
 * Handles the full release workflow: clean, prebuild, build IPA, upload.
 *
 * Usage:
 *   bun scripts/release-ios.ts [testflight|appstore]
 *
 * Tracks:
 *   testflight - Upload to TestFlight (default)
 *   appstore   - Upload to App Store for review
 *
 * Required environment variables:
 *   APPLE_TEAM_ID                  - Apple Developer Team ID
 *   APP_STORE_CONNECT_API_KEY_JSON - App Store Connect API credentials
 *
 * What it does:
 *   1. Cleans .expo and ios directories
 *   2. Runs expo prebuild with RELEASE=true
 *   3. Builds release IPA via Fastlane
 *   4. Uploads to App Store Connect via Fastlane
 */

import { $ } from 'bun'
import path from 'node:path'

const projectRoot = path.resolve(import.meta.dir, '..')

// Get track from command line args
const track = Bun.argv[2] || 'testflight'

if (track !== 'testflight' && track !== 'appstore') {
  console.error('Usage: bun scripts/release-ios.ts [testflight|appstore]')
  console.error('  testflight - Upload to TestFlight (default)')
  console.error('  appstore   - Upload to App Store')
  process.exit(1)
}

// Verify required environment variables
const requiredVars = ['APPLE_TEAM_ID', 'APP_STORE_CONNECT_API_KEY_JSON']

const missingVars = requiredVars.filter((v) => !Bun.env[v])
if (missingVars.length > 0) {
  console.error('Error: Missing required environment variables:')
  missingVars.forEach((v) => console.error(`  - ${v}`))
  process.exit(1)
}

$.cwd(projectRoot)

console.log(`=== iOS Release Build (${track}) ===`)

// Step 1: Clean and prebuild
console.log('Step 1/3: Cleaning and prebuilding...')
await $`bunx rimraf .expo ios`
await $`RELEASE=true bunx expo prebuild --platform ios`

// Step 2: Build IPA
console.log('Step 2/3: Building release IPA...')
await $`fastlane ios build_ipa`

// Step 3: Upload to App Store Connect
console.log(`Step 3/3: Uploading to App Store Connect (${track})...`)
if (track === 'testflight') {
  await $`fastlane ios distribute_testflight`
} else {
  await $`fastlane ios distribute_app_store`
}

console.log('=== iOS release complete! ===')
