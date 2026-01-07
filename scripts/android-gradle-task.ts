#!/usr/bin/env bun
/**
 * Android Gradle Task Runner
 *
 * Runs Gradle tasks in the Android project directory with proper environment setup.
 * Handles keystore resolution and JVM memory configuration.
 *
 * Usage:
 *   bun scripts/android-gradle-task.ts <task>
 *
 * Examples:
 *   bun scripts/android-gradle-task.ts signingReport    # Show signing configuration
 *   bun scripts/android-gradle-task.ts bundleRelease    # Build release AAB
 *   bun scripts/android-gradle-task.ts assembleRelease  # Build release APK
 *
 * Required environment variables:
 *   SIA_RELEASE_STORE_FILE      - Path to the release keystore file
 *   SIA_RELEASE_STORE_PASSWORD  - Keystore password
 *   SIA_RELEASE_KEY_ALIAS       - Key alias in the keystore
 *   SIA_RELEASE_KEY_PASSWORD    - Key password
 *
 * What it does:
 *   - Validates required environment variables are set
 *   - Resolves keystore path (relative paths resolved from project root)
 *   - Sets JVM memory limits to prevent OOM during builds
 *   - Runs the specified Gradle task in android/ directory
 */

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'

const projectRoot = path.resolve(__dirname, '..')

const task = process.argv[2]
if (!task) {
  console.error(
    'Missing Gradle task argument (e.g. signingReport or bundleRelease).'
  )
  process.exit(1)
}

const androidDir = path.join(projectRoot, 'android')
const requiredEnvKeys = [
  'SIA_RELEASE_STORE_FILE',
  'SIA_RELEASE_STORE_PASSWORD',
  'SIA_RELEASE_KEY_ALIAS',
  'SIA_RELEASE_KEY_PASSWORD',
]

const missing = requiredEnvKeys.filter((key) => !process.env[key])
if (missing.length > 0) {
  console.error(
    `Missing required environment variables: ${missing.join(
      ', '
    )}. Ensure they are defined in your .env file or shell.`
  )
  process.exit(1)
}

const envOverrides: Record<string, string> = {}

// Set JVM memory settings to prevent out of memory errors during builds
// These settings won't be regenerated since they're in this script
// Use -D to override gradle.properties settings
const jvmArgs =
  '-Xmx4096m -XX:MaxMetaspaceSize=1024m -XX:+HeapDumpOnOutOfMemoryError'

const storeFile = process.env.SIA_RELEASE_STORE_FILE
if (storeFile) {
  const resolvedStoreFile = path.isAbsolute(storeFile)
    ? storeFile
    : path.resolve(projectRoot, storeFile)

  if (!fs.existsSync(resolvedStoreFile)) {
    console.error(`Release keystore not found at ${resolvedStoreFile}.`)
    process.exit(1)
  }

  envOverrides.SIA_RELEASE_STORE_FILE = resolvedStoreFile
}

const finalEnv = { ...process.env, ...envOverrides }

// Pass JVM args as system property to override gradle.properties
// This ensures the memory settings are applied even if gradle.properties is regenerated
const result = spawnSync(
  './gradlew',
  [`-Dorg.gradle.jvmargs=${jvmArgs}`, task],
  {
    cwd: androidDir,
    stdio: 'inherit',
    env: finalEnv,
  }
)

if (result.error) {
  console.error(result.error)
}

if (typeof result.status === 'number') {
  process.exit(result.status)
}

process.exit(1)
