#!/usr/bin/env bun

/**
 * Android Gradle Task Runner
 *
 * Runs Gradle tasks with proper environment and memory settings.
 *
 * Usage:
 *   bun scripts/androidGradleTask.ts <task>
 *
 * Examples:
 *   bun scripts/androidGradleTask.ts signingReport
 *   bun scripts/androidGradleTask.ts bundleRelease
 *
 * Required environment variables:
 *   SIA_RELEASE_STORE_FILE     - Path to release keystore
 *   SIA_RELEASE_STORE_PASSWORD - Keystore password
 *   SIA_RELEASE_KEY_ALIAS      - Key alias
 *   SIA_RELEASE_KEY_PASSWORD   - Key password
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const projectRoot = path.resolve(__dirname, '..')

const task = process.argv[2]
if (!task) {
  console.error(
    'Missing Gradle task argument (e.g. signingReport or bundleRelease).',
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
      ', ',
    )}. Ensure they are defined in your .env file or shell.`,
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
  },
)

if (result.error) {
  console.error(result.error)
}

if (typeof result.status === 'number') {
  process.exit(result.status)
}

process.exit(1)
