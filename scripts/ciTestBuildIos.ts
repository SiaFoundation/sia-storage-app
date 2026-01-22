#!/usr/bin/env bun
/**
 * CI iOS Test Build
 *
 * Builds iOS app for Simulator in Release mode for CI E2E testing.
 * Uses ad-hoc signing to preserve entitlements (required for keychain access).
 *
 * Usage:
 *   bun scripts/ciTestBuildIos.ts
 */

import { $ } from 'bun'
import { existsSync } from 'fs'
import { join } from 'path'

const PROJECT_ROOT = join(import.meta.dir, '..')
const IOS_DIR = join(PROJECT_ROOT, 'ios')
const DERIVED_DATA = join(PROJECT_ROOT, 'ios/DerivedData')

$.cwd(PROJECT_ROOT)

console.log('=== iOS CI Build (Simulator Release) ===')

// Step 1: Clean and prebuild
console.log('\nStep 1/2: Cleaning and prebuilding...')
if (existsSync(IOS_DIR)) {
  await $`rm -rf ${IOS_DIR}`.quiet()
}
await $`bunx expo prebuild --platform ios`

// Step 2: Build Release for simulator with ad-hoc signing
// CODE_SIGN_IDENTITY=- and CODE_SIGNING_ALLOWED=YES preserves entitlements
// (required for keychain/secure storage access)
console.log('\nStep 2/2: Building Release for iOS Simulator...')

const xcodebuildArgs = [
  '-workspace', 'ios/SiaStorageDev.xcworkspace',
  '-scheme', 'SiaStorageDev',
  '-configuration', 'Release',
  '-sdk', 'iphonesimulator',
  '-derivedDataPath', DERIVED_DATA,
  'build',
  'CODE_SIGN_IDENTITY=-',
  'CODE_SIGNING_ALLOWED=YES',
]

const result = await $`xcodebuild ${xcodebuildArgs}`.nothrow()

if (result.exitCode !== 0) {
  console.error('❌ iOS build failed')
  process.exit(result.exitCode)
}

console.log('\n✅ iOS CI build complete!')
console.log(`   App location: ${DERIVED_DATA}/Build/Products/Release-iphonesimulator/`)
