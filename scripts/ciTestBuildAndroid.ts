#!/usr/bin/env bun
/**
 * CI Android Test Build
 *
 * Builds a debug APK for CI testing. No signing required.
 * Used in GitHub Actions to verify the Android build compiles.
 *
 * Usage:
 *   bun scripts/ciTestBuildAndroid.ts
 */

import { $ } from 'bun'
import path from 'node:path'

const projectRoot = path.resolve(import.meta.dir, '..')

$.cwd(projectRoot)

console.log('=== Android Build (Debug) ===')

// Step 1: Clean and prebuild
console.log('Step 1/2: Cleaning and prebuilding...')
await $`bunx rimraf .expo android`
await $`bunx expo prebuild --platform android`

// Step 2: Build debug APK (no signing required)
console.log('Step 2/2: Building debug APK...')
const jvmArgs =
  '-Xmx4096m -XX:MaxMetaspaceSize=1024m -XX:+HeapDumpOnOutOfMemoryError'

await $`cd android && ./gradlew assembleDebug --no-daemon -Dorg.gradle.jvmargs=${jvmArgs}`

console.log('=== Android build complete! ===')
