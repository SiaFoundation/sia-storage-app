#!/usr/bin/env bun
/**
 * CI iOS Test Build
 *
 * Builds for iOS Simulator in Release mode. No code signing required.
 * Used in GitHub Actions to verify the iOS build compiles.
 *
 * Usage:
 *   bun scripts/ciTestBuildIos.ts
 */

import { $ } from 'bun'
import path from 'node:path'

const projectRoot = path.resolve(import.meta.dir, '..')

$.cwd(projectRoot)

console.log('=== iOS Build (Simulator) ===')

// Step 1: Clean and prebuild
console.log('Step 1/2: Cleaning and prebuilding...')
await $`bunx rimraf .expo ios`
await $`bunx expo prebuild --platform ios`

// Step 2: Build for simulator (no code signing required)
console.log('Step 2/2: Building for iOS Simulator...')
await $`xcodebuild -workspace ios/SiaStorageDev.xcworkspace -scheme SiaStorageDev -configuration Release -sdk iphonesimulator -destination generic/platform=iOS\ Simulator build CODE_SIGNING_ALLOWED=NO EXCLUDED_ARCHS=x86_64`

console.log('=== iOS build complete! ===')
