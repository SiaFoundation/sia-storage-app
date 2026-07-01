#!/usr/bin/env bun

/**
 * Android Release Build & Distribution
 *
 * Builds a signed Android AAB and uploads to Google Play Store.
 *
 * Usage:
 *   bun scripts/releaseAndroid.ts [internal|production]
 *
 * Environment variables:
 *   APP_VARIANT                          - Which app to build: beta | prod (default prod)
 *   SIA_RELEASE_STORE_FILE               - Path to release keystore
 *   SIA_RELEASE_STORE_PASSWORD           - Keystore password
 *   SIA_RELEASE_KEY_ALIAS                - Key alias
 *   SIA_RELEASE_KEY_PASSWORD             - Key password
 *   GOOGLE_PLAY_SERVICE_ACCOUNT_KEY_JSON - Google Play service account key
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { $ } from 'bun'
import pkg from '../package.json'
import { resolveVariant } from '../variants'
import { whatsNewText } from './releaseNotes'

const projectRoot = path.resolve(import.meta.dir, '..')

// Get track from command line args
const track = Bun.argv[2] || 'internal'

if (track !== 'internal' && track !== 'production') {
  console.error('Usage: bun scripts/releaseAndroid.ts [internal|production]')
  console.error('  internal   - Upload to internal testing track (default)')
  console.error('  production - Upload to production track')
  process.exit(1)
}

// Which app identity to build. CI sets APP_VARIANT per matrix leg; default to
// prod so a bare `release:android:*` invocation builds the public app.
const variant = resolveVariant(Bun.env.APP_VARIANT || 'prod')

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

// Export the resolved identity so `expo prebuild` (app.config.js) and Fastlane
// (Appfile) target the same app. variants.js is the one source of truth.
process.env.APP_VARIANT = variant.key
process.env.ANDROID_PACKAGE = variant.bundleId

$.cwd(projectRoot)

console.log(`=== Android Release Build (${variant.name} / ${track}) ===`)

// Step 1: Clean and prebuild
console.log('Step 1/3: Cleaning and prebuilding...')
await $`bunx rimraf .expo android`
await $`bunx expo prebuild --platform android`

// Step 2: Build AAB
console.log('Step 2/3: Building release AAB...')
await $`bun scripts/androidGradleTask.ts bundleRelease`

// Step 3: Upload to Play Store
if (Bun.env.DRY_RUN === 'true') {
  console.log('Step 3/3: DRY_RUN=true — skipping Play Store upload.')
} else {
  console.log(`Step 3/3: Uploading to Play Store (${track} track)...`)
  if (track === 'internal') {
    // supply has no inline release-notes option; it reads "What's new" from a
    // per-locale changelog file. default.txt applies to any versionCode.
    const changelogDir = path.join(projectRoot, 'fastlane/metadata/android/en-US/changelogs')
    mkdirSync(changelogDir, { recursive: true })
    writeFileSync(path.join(changelogDir, 'default.txt'), whatsNewText(pkg.version))
    await $`fastlane android distribute_internal`
  } else {
    await $`fastlane android distribute_play_store`
  }
}

console.log('=== Android release complete! ===')
