#!/usr/bin/env bun
/**
 * Android CI Build Script (Release)
 *
 * Builds the Android app for emulator testing in CI environments.
 * Used by the GitHub Actions E2E workflow.
 *
 * Usage:
 *   bun scripts/ci-test-build-android.ts
 *
 * What it does:
 *   - Builds a Release APK for Android emulator
 *   - Bundles JS into the APK (no Metro server needed)
 *   - Only builds x86_64 architecture (for CI emulator, saves disk space)
 *   - Sets JVM memory limits to prevent OOM during build
 *
 * Note: CI handles prebuild and caching separately. This script only builds.
 */

import { $ } from 'bun'
import path from 'node:path'

const projectRoot = path.resolve(import.meta.dir, '..')

$.cwd(projectRoot)

console.log('=== Android CI Build (Release) ===')

// CI handles prebuild/caching separately - this script only builds
// Use Release config - bundles JS into APK, no Metro server needed
// Only build x86_64 for emulator testing - saves disk space and time
console.log('Building release APK (x86_64 only for emulator)...')
const jvmArgs =
  '-Xmx4096m -XX:MaxMetaspaceSize=1024m -XX:+HeapDumpOnOutOfMemoryError'

await $`cd android && ./gradlew assembleRelease --no-daemon -Dorg.gradle.jvmargs=${jvmArgs} -PreactNativeArchitectures=x86_64`

console.log('=== Android build complete! ===')
