#!/usr/bin/env bun
/**
 * CI Android Test Build
 *
 * Builds Android APK in Release mode for CI E2E testing.
 * Builds x86_64 only for CI emulator compatibility.
 *
 * Usage:
 *   bun scripts/ciTestBuildAndroid.ts
 */

import { $ } from 'bun'
import { existsSync } from 'fs'
import { join } from 'path'

const PROJECT_ROOT = join(import.meta.dir, '..')
const ANDROID_DIR = join(PROJECT_ROOT, 'android')

$.cwd(PROJECT_ROOT)

console.log('=== Android CI Build (Release x86_64) ===')

// Step 1: Clean and prebuild
console.log('\nStep 1/2: Cleaning and prebuilding...')
if (existsSync(ANDROID_DIR)) {
  await $`rm -rf ${ANDROID_DIR}`.quiet()
}
await $`bunx expo prebuild --platform android`

// Step 2: Build Release APK for x86_64 (CI emulators)
console.log('\nStep 2/2: Building Release APK (x86_64)...')

const jvmArgs = '-Xmx4096m -XX:MaxMetaspaceSize=1024m -XX:+HeapDumpOnOutOfMemoryError'

const result = await $`./gradlew assembleRelease --no-daemon -Dorg.gradle.jvmargs=${jvmArgs} -PreactNativeArchitectures=x86_64`
  .cwd(ANDROID_DIR)
  .nothrow()

if (result.exitCode !== 0) {
  console.error('❌ Android build failed')
  process.exit(result.exitCode)
}

console.log('\n✅ Android CI build complete!')
console.log(`   APK location: ${ANDROID_DIR}/app/build/outputs/apk/release/`)
