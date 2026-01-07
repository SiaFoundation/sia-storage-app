#!/usr/bin/env bun
/**
 * Android Release Build & Upload Script
 *
 * Builds and uploads the Android app to Google Play Store.
 * Handles the full release workflow: clean, prebuild, build AAB, upload.
 *
 * Usage:
 *   bun scripts/release-android.ts [internal|production]
 *
 * Tracks:
 *   internal   - Upload to internal testing track (default)
 *   production - Upload to production track
 *
 * Required environment variables:
 *   SIA_RELEASE_STORE_FILE              - Path to the release keystore
 *   SIA_RELEASE_STORE_PASSWORD          - Keystore password
 *   SIA_RELEASE_KEY_ALIAS               - Key alias
 *   SIA_RELEASE_KEY_PASSWORD            - Key password
 *   GOOGLE_PLAY_SERVICE_ACCOUNT_KEY_JSON - Google Play API credentials
 *
 * What it does:
 *   1. Cleans .expo and android directories
 *   2. Runs expo prebuild with RELEASE=true
 *   3. Builds release AAB via android-gradle-task.ts
 *   4. Uploads to Play Store via Fastlane
 */

import { $ } from 'bun'
import path from 'node:path'

const projectRoot = path.resolve(import.meta.dir, '..')

// Get track from command line args
const track = Bun.argv[2] || 'internal'

if (track !== 'internal' && track !== 'production') {
  console.error('Usage: bun scripts/release-android.ts [internal|production]')
  console.error('  internal   - Upload to internal testing track (default)')
  console.error('  production - Upload to production track')
  process.exit(1)
}

// Verify required environment variables
const requiredVars = [
  'SIA_RELEASE_STORE_FILE',
  'SIA_RELEASE_STORE_PASSWORD',
  'SIA_RELEASE_KEY_ALIAS',
  'SIA_RELEASE_KEY_PASSWORD',
  'GOOGLE_PLAY_SERVICE_ACCOUNT_KEY_JSON',
]

const missingVars = requiredVars.filter((v) => !Bun.env[v])
if (missingVars.length > 0) {
  console.error('Error: Missing required environment variables:')
  missingVars.forEach((v) => console.error(`  - ${v}`))
  process.exit(1)
}

$.cwd(projectRoot)

console.log(`=== Android Release Build (${track}) ===`)

// Step 1: Clean and prebuild
console.log('Step 1/3: Cleaning and prebuilding...')
await $`bunx rimraf .expo android`
await $`RELEASE=true bunx expo prebuild --platform android`

// Step 2: Build AAB
console.log('Step 2/3: Building release AAB...')
await $`bun scripts/android-gradle-task.ts bundleRelease`

// Step 3: Upload to Play Store
console.log(`Step 3/3: Uploading to Play Store (${track} track)...`)
if (track === 'internal') {
  await $`fastlane android distribute_internal`
} else {
  await $`fastlane android distribute_play_store`
}

console.log('=== Android release complete! ===')
