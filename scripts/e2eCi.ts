#!/usr/bin/env bun
/**
 * CI E2E Test Runner
 *
 * Runs Maestro E2E tests in CI environment. Uses release builds without Metro.
 *
 * Usage:
 *   bun scripts/e2eCi.ts ios [flow.yml]
 *   bun scripts/e2eCi.ts android [flow.yml]
 *
 * CI Environment:
 *   - Uses release builds (no Metro bundler)
 *   - Runs headless by default
 *   - Expects simulator/emulator to already be booted
 *   - Expects app to already be built and installed
 *
 * This script is designed to be called after the build job completes.
 * It only handles test execution, not building.
 */

import { $ } from 'bun'
import { existsSync, readdirSync, mkdirSync } from 'fs'
import { join } from 'path'

const PROJECT_ROOT = join(import.meta.dir, '..')
const E2E_DIR = join(PROJECT_ROOT, 'test/e2e')
const FLOWS_DIR = join(E2E_DIR, 'flows')
const OUTPUT_DIR = join(E2E_DIR, '.maestro/tests')

// App bundle IDs
const IOS_BUNDLE_ID = 'sia.storage.dev'
const ANDROID_PACKAGE = 'sia.storage.dev'

// Parse args
const args = process.argv.slice(2)
const platformArg = args.find(a => a === 'ios' || a === 'android')
const flow = args.find(a => a.endsWith('.yml')) || 'onboarding.yml'

if (!platformArg) {
  console.error('Usage: bun scripts/e2eCi.ts <platform> [flow.yml]')
  console.error('')
  console.error('Platforms:')
  console.error('  ios       Run on iOS Simulator')
  console.error('  android   Run on Android emulator')
  process.exit(1)
}

const platform = platformArg

// Ensure output dir exists
if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true })
}

// Find iOS app from build output
async function findIosApp(): Promise<string> {
  // Look for app in standard build locations
  const searchPaths = [
    join(PROJECT_ROOT, 'ios/build/Build/Products/Release-iphonesimulator'),
    join(PROJECT_ROOT, 'ios/DerivedData/Build/Products/Release-iphonesimulator'),
  ]

  for (const searchPath of searchPaths) {
    if (existsSync(searchPath)) {
      const result = await $`find ${searchPath} -name "*.app" -type d 2>/dev/null`.quiet().nothrow()
      const found = result.stdout.toString().trim().split('\n').filter(Boolean)[0]
      if (found) return found
    }
  }

  // Fallback to find in entire ios directory
  const result = await $`find ${join(PROJECT_ROOT, 'ios')} -name "*.app" -path "*Release*" -type d 2>/dev/null`.quiet().nothrow()
  const found = result.stdout.toString().trim().split('\n').filter(Boolean)[0]
  if (!found) {
    throw new Error('iOS app not found. Ensure the build step completed successfully.')
  }
  return found
}

// Find Android APK from build output
async function findAndroidApk(): Promise<string> {
  const apkDir = join(PROJECT_ROOT, 'android/app/build/outputs/apk/release')
  if (!existsSync(apkDir)) {
    throw new Error(`APK directory not found: ${apkDir}`)
  }

  const result = await $`find ${apkDir} -name "*.apk" 2>/dev/null`.quiet().nothrow()
  const apkPath = result.stdout.toString().trim().split('\n').filter(Boolean)[0]
  if (!apkPath) {
    throw new Error('Android APK not found. Ensure the build step completed successfully.')
  }
  return apkPath
}

// Install iOS app
async function installIosApp(): Promise<void> {
  console.log('📲 Installing iOS app...')
  const appPath = await findIosApp()
  console.log(`   App: ${appPath}`)
  await $`xcrun simctl install booted ${appPath}`
  console.log('✅ iOS app installed')
}

// Install Android app
async function installAndroidApp(): Promise<void> {
  console.log('📲 Installing Android app...')
  const apkPath = await findAndroidApk()
  console.log(`   APK: ${apkPath}`)
  await $`adb install -r ${apkPath}`
  console.log('✅ Android app installed')
}

// Find latest screenshot folder
function findLatestScreenshots(): string | null {
  if (!existsSync(OUTPUT_DIR)) return null
  const folders = readdirSync(OUTPUT_DIR)
    .filter(f => {
      const dir = join(OUTPUT_DIR, f)
      return existsSync(dir) && readdirSync(dir).some(f => f.endsWith('.png'))
    })
    .sort()
    .reverse()
  return folders.length > 0 ? join(OUTPUT_DIR, folders[0]) : null
}

// Main
async function main() {
  console.log(`\n🚀 CI E2E Test Runner`)
  console.log(`   Platform: ${platform}`)
  console.log(`   Flow: ${flow}`)
  console.log('')

  try {
    // 1. Install app (assumes build already completed)
    if (platform === 'ios') {
      await installIosApp()
    } else {
      await installAndroidApp()
    }

    // 2. Run E2E test
    console.log(`\n🧪 Running E2E test: ${flow}\n`)

    const flowPath = join(FLOWS_DIR, flow)
    if (!existsSync(flowPath)) {
      throw new Error(`Flow not found: ${flowPath}`)
    }

    const env = {
      ...process.env,
      PATH: `${process.env.PATH}:${process.env.HOME}/.maestro/bin`,
      MAESTRO_DRIVER_STARTUP_TIMEOUT: '300000',
      MAESTRO_CLI_NO_ANALYTICS: '1',
      MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: 'true',
    }

    const maestroArgs = ['test', flowPath, '--output', OUTPUT_DIR]
    if (process.env.E2E_CONNECT_KEY) {
      maestroArgs.push('-e', `E2E_CONNECT_KEY=${process.env.E2E_CONNECT_KEY}`)
    }

    const result = await $`maestro ${maestroArgs}`.env(env).nothrow()

    if (result.exitCode !== 0) {
      console.log('\n❌ E2E test failed')
      const screenshotDir = findLatestScreenshots()
      if (screenshotDir) {
        console.log(`📸 Screenshots: ${screenshotDir}`)
      }
      process.exit(result.exitCode)
    }

    console.log('\n✅ E2E test passed!')
    process.exit(0)

  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

main()
