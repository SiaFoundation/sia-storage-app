#!/usr/bin/env bun
/**
 * iOS CI Build Script (Simulator)
 *
 * Builds the iOS app for simulator testing in CI environments.
 * Used by the GitHub Actions E2E workflow.
 *
 * Usage:
 *   bun scripts/ci-test-build-ios.ts
 *
 * What it does:
 *   - Builds a Release configuration for iOS Simulator
 *   - Bundles JS into the app (no Metro server needed)
 *   - Excludes x86_64 architecture (arm64 only for Apple Silicon runners)
 *   - Disables code signing (not needed for simulator)
 *
 * Note: CI handles prebuild and caching separately. This script only builds.
 */

import { $ } from 'bun'
import path from 'node:path'

const projectRoot = path.resolve(import.meta.dir, '..')

$.cwd(projectRoot)

console.log('=== iOS CI Build (Simulator) ===')

// CI handles prebuild/caching separately - this script only builds
// Use Release config - bundles JS into app, no Metro server needed
console.log('Building for iOS Simulator (Release)...')
await $`xcodebuild -workspace ios/SiaStorageDev.xcworkspace -scheme SiaStorageDev -configuration Release -sdk iphonesimulator -destination generic/platform=iOS\ Simulator build CODE_SIGNING_ALLOWED=NO EXCLUDED_ARCHS=x86_64`

console.log('=== iOS build complete! ===')
