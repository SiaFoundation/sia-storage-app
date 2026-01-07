#!/usr/bin/env bun
/**
 * E2E Test Runner with Smart Build Caching (Local Development)
 *
 * Builds, installs, and runs E2E tests locally with intelligent caching.
 * Handles the full workflow: boot device, build app, install, start Metro, run tests.
 *
 * Usage:
 *   bun scripts/e2e-run-local.ts ios              # Run on iOS Simulator
 *   bun scripts/e2e-run-local.ts android          # Run on Android emulator
 *   bun scripts/e2e-run-local.ts ios flow.yml     # Run specific flow
 *
 * Flags:
 *   --rebuild       Force a fresh build (ignore cache)
 *   --skip-install  Skip app installation (if already installed)
 *   --headless      Run simulator/emulator without UI window
 *
 * Environment:
 *   E2E_CONNECT_KEY  - App password for indexer auth (required for auth tests)
 *   E2E_INDEXER_URL  - Custom indexer URL (optional, defaults to https://app.sia.storage)
 *
 * How caching works:
 *   - Uses shared build cache from scripts/build-cache.ts
 *   - E2E builds stored in .build-cache/e2e-ios/ and .build-cache/e2e-android/
 *   - Separate from dev builds, survives rimraf ios/android
 *
 * CI Note:
 *   iOS Simulator supports headless mode via --headless flag.
 *   On CI, also set MAESTRO_DRIVER_STARTUP_TIMEOUT for slower VMs.
 *
 * For CI (release builds without caching logic), use e2e-run.ts instead.
 */

import { $ } from 'bun'
import { existsSync, readdirSync, mkdirSync } from 'fs'
import { join } from 'path'
import {
  PROJECT_ROOT,
  type BuildTarget,
  getTargetPaths,
  needsRebuild,
  saveBuildHash,
  ensureCacheDir,
  writeBuildLog,
  getBuildLogTail,
} from './build-cache'

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
const forceRebuild = args.includes('--rebuild')
const skipInstall = args.includes('--skip-install')
const headless = args.includes('--headless')

// Require explicit platform
if (!platformArg) {
  console.error('Usage: bun scripts/e2e-run-local.ts <platform> [flow.yml] [flags]')
  console.error('')
  console.error('Platforms:')
  console.error('  ios       Run on iOS Simulator')
  console.error('  android   Run on Android emulator')
  console.error('')
  console.error('Flags:')
  console.error('  --rebuild       Force a fresh build (ignore cache)')
  console.error('  --skip-install  Skip app installation')
  console.error('  --headless      Run simulator/emulator without UI')
  console.error('')
  console.error('Example:')
  console.error('  E2E_CONNECT_KEY="..." bun scripts/e2e-run-local.ts ios onboarding.yml')
  process.exit(1)
}

const platform = platformArg
const target: BuildTarget = platform === 'android' ? 'e2e-android' : 'e2e-ios'

const paths = getTargetPaths(target)

// Ensure output dir exists
if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true })
}

// Check if iOS simulator is booted
async function isIosSimulatorBooted(): Promise<boolean> {
  const result = await $`xcrun simctl list devices booted`.quiet().nothrow()
  return result.stdout.toString().includes('iPhone')
}

// Boot iOS simulator
async function bootIosSimulator(): Promise<void> {
  if (await isIosSimulatorBooted()) {
    console.log('📱 iOS Simulator already running')
    return
  }

  console.log(`📱 Booting iOS Simulator${headless ? ' (headless)' : ''}...`)
  const devices = await $`xcrun simctl list devices available`.text()
  const match = devices.match(/iPhone[^(]*\(([^)]+)\)/)
  if (!match) throw new Error('No iPhone simulator found')

  await $`xcrun simctl boot ${match[1]}`

  // Open Simulator.app unless headless
  // Note: iOS Simulator runs headless by default when booted via CLI
  // Opening Simulator.app just shows the UI window
  if (!headless) {
    await $`open -a Simulator`.nothrow()
  }

  // Wait for boot
  await new Promise(resolve => setTimeout(resolve, 3000))
}

// Check if Android emulator is running
async function isAndroidEmulatorRunning(): Promise<boolean> {
  const result = await $`adb shell getprop sys.boot_completed 2>/dev/null`.quiet().nothrow()
  return result.stdout.toString().trim() === '1'
}

// Boot Android emulator
async function bootAndroidEmulator(): Promise<void> {
  if (await isAndroidEmulatorRunning()) {
    console.log('🤖 Android Emulator already running')
    return
  }

  console.log('🤖 Booting Android Emulator...')
  const avdsResult = await $`emulator -list-avds`.quiet().nothrow()
  const avds = avdsResult.stdout.toString().trim().split('\n').filter(Boolean)
  if (avds.length === 0) throw new Error('No Android AVD found. Create one in Android Studio.')

  const avd = avds[0]
  console.log(`   Using AVD: ${avd}`)

  // Start emulator in background
  const emulatorArgs = headless
    ? `-avd ${avd} -no-window -no-audio -no-boot-anim`
    : `-avd ${avd}`

  Bun.spawn(['sh', '-c', `emulator ${emulatorArgs} &`], {
    stdout: 'ignore',
    stderr: 'ignore',
  })

  // Wait for boot
  console.log('   Waiting for emulator to boot...')
  await $`adb wait-for-device`

  for (let i = 0; i < 60; i++) {
    const result = await $`adb shell getprop sys.boot_completed 2>/dev/null`.quiet().nothrow()
    if (result.stdout.toString().trim() === '1') break
    await new Promise(resolve => setTimeout(resolve, 2000))
  }

  console.log('   Emulator booted')
}

// Build iOS app
async function buildIos(): Promise<void> {
  console.log('🔨 Building iOS app...')
  console.log(`   Build log: ${paths.buildLog}`)
  $.cwd(PROJECT_ROOT)

  ensureCacheDir(target)

  // Prebuild if needed (with E2E_TEST=true to enable in-memory keychain)
  const iosDir = join(PROJECT_ROOT, 'ios')
  if (!existsSync(iosDir)) {
    console.log('   Prebuilding...')
    const prebuildResult = await $`E2E_TEST=true bunx expo prebuild --platform ios 2>&1`.quiet().nothrow()
    writeBuildLog(target, `=== PREBUILD ===\n${prebuildResult.stdout}\n`)
    if (prebuildResult.exitCode !== 0) {
      console.error('❌ Prebuild failed. Last 30 lines:')
      console.error(getBuildLogTail(target, 30))
      throw new Error('iOS prebuild failed')
    }
  }

  // Build for simulator using xcodebuild with dedicated DerivedData
  console.log('   Compiling (this may take a while)...')
  const buildResult = await $`xcodebuild \
    -workspace ios/SiaStorageDev.xcworkspace \
    -scheme SiaStorageDev \
    -configuration Debug \
    -sdk iphonesimulator \
    -arch arm64 \
    -derivedDataPath ${paths.derivedData} \
    build \
    CODE_SIGNING_ALLOWED=NO 2>&1`.quiet().nothrow()

  writeBuildLog(target, `=== XCODEBUILD ===\n${buildResult.stdout}`, true)

  if (buildResult.exitCode !== 0 || buildResult.stdout.toString().includes('BUILD FAILED')) {
    console.error('❌ Build failed. Last 50 lines:')
    console.error(getBuildLogTail(target, 50))
    throw new Error('iOS build failed - see ' + paths.buildLog)
  }

  saveBuildHash(target)
  console.log('✅ iOS build complete')
}

// Build Android app
async function buildAndroid(): Promise<void> {
  console.log('🔨 Building Android app...')
  console.log(`   Build log: ${paths.buildLog}`)
  $.cwd(PROJECT_ROOT)

  ensureCacheDir(target)

  // Prebuild if needed (with E2E_TEST=true to enable in-memory keychain)
  const androidDir = join(PROJECT_ROOT, 'android')
  if (!existsSync(androidDir)) {
    console.log('   Prebuilding...')
    const prebuildResult = await $`E2E_TEST=true bunx expo prebuild --platform android 2>&1`.quiet().nothrow()
    writeBuildLog(target, `=== PREBUILD ===\n${prebuildResult.stdout}\n`)
    if (prebuildResult.exitCode !== 0) {
      console.error('❌ Prebuild failed. Last 30 lines:')
      console.error(getBuildLogTail(target, 30))
      throw new Error('Android prebuild failed')
    }
  }

  // Build debug APK
  console.log('   Compiling (this may take a while)...')
  $.cwd(join(PROJECT_ROOT, 'android'))
  const buildResult = await $`./gradlew assembleDebug --no-daemon 2>&1`.quiet().nothrow()
  $.cwd(PROJECT_ROOT)
  writeBuildLog(target, `=== GRADLE ===\n${buildResult.stdout}`, true)

  if (buildResult.exitCode !== 0 || buildResult.stdout.toString().includes('BUILD FAILED')) {
    console.error('❌ Build failed. Last 50 lines:')
    console.error(getBuildLogTail(target, 50))
    throw new Error('Android build failed - see ' + paths.buildLog)
  }

  saveBuildHash(target)
  console.log('✅ Android build complete')
}

// Find iOS app path
async function findIosApp(): Promise<string> {
  if (!existsSync(paths.derivedData)) {
    throw new Error('iOS app not found. Run with --rebuild')
  }

  const result = await $`find ${paths.derivedData} -name "*.app" -path "*Debug-iphonesimulator*" -type d 2>/dev/null`.quiet().nothrow()
  const found = result.stdout.toString().trim().split('\n').filter(Boolean)[0]
  if (!found) {
    throw new Error('iOS app not found in DerivedData. Run with --rebuild')
  }
  return found
}

// Find Android APK path
async function findAndroidApk(): Promise<string> {
  const androidDir = join(PROJECT_ROOT, 'android')
  const result = await $`find ${androidDir} -name "*.apk" -path "*debug*" 2>/dev/null`.quiet().nothrow()
  const apkPath = result.stdout.toString().trim().split('\n').filter(Boolean)[0]
  if (!apkPath) throw new Error('Android APK not found. Run with --rebuild')
  return apkPath
}

// Check if iOS app is installed on simulator
async function isIosAppInstalled(): Promise<boolean> {
  const result = await $`xcrun simctl listapps booted 2>/dev/null`.quiet().nothrow()
  return result.stdout.toString().includes(IOS_BUNDLE_ID)
}

// Check if Android app is installed on emulator
async function isAndroidAppInstalled(): Promise<boolean> {
  const result = await $`adb shell pm list packages ${ANDROID_PACKAGE} 2>/dev/null`.quiet().nothrow()
  return result.stdout.toString().includes(ANDROID_PACKAGE)
}

// Install iOS app
async function installIosApp(): Promise<void> {
  if (skipInstall) {
    console.log('📲 Skipping iOS app install (--skip-install)')
    return
  }

  if (await isIosAppInstalled()) {
    console.log('📲 iOS app already installed')
    return
  }

  console.log('📲 Installing iOS app...')
  const appPath = await findIosApp()
  await $`xcrun simctl install booted ${appPath}`
  console.log('✅ iOS app installed')
}

// Install Android app
async function installAndroidApp(): Promise<void> {
  if (skipInstall) {
    console.log('📲 Skipping Android app install (--skip-install)')
    return
  }

  if (await isAndroidAppInstalled()) {
    console.log('📲 Android app already installed')
    return
  }

  console.log('📲 Installing Android app...')
  const apkPath = await findAndroidApk()
  await $`adb install -r ${apkPath}`
  console.log('✅ Android app installed')
}

// Check if Metro is running
async function isMetroRunning(): Promise<boolean> {
  try {
    const response = await fetch('http://localhost:8081/status')
    const text = await response.text()
    return text.includes('packager-status:running')
  } catch {
    return false
  }
}

// Start Metro if not running (with E2E_TEST=true for in-memory keychain)
async function ensureMetroRunning(): Promise<void> {
  if (await isMetroRunning()) {
    console.log('🚇 Metro already running')
    return
  }

  console.log('🚇 Starting Metro (E2E mode)...')

  Bun.spawn(['bun', 'run', 'start'], {
    cwd: PROJECT_ROOT,
    stdout: 'ignore',
    stderr: 'ignore',
    env: { ...process.env, E2E_TEST: 'true' },
  })

  // Wait for Metro to be ready
  for (let i = 0; i < 60; i++) {
    if (await isMetroRunning()) {
      console.log('✅ Metro ready')
      return
    }
    await new Promise(resolve => setTimeout(resolve, 2000))
  }

  throw new Error('Metro failed to start')
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
  console.log(`\n🚀 E2E Test Runner`)
  console.log(`   Platform: ${platform}`)
  console.log(`   Flow: ${flow}`)
  console.log(`   Cache: .build-cache/${target}/`)
  console.log(`   Flags: ${[forceRebuild && '--rebuild', skipInstall && '--skip-install', headless && '--headless'].filter(Boolean).join(' ') || 'none'}`)
  console.log('')

  try {
    // 1. Boot device
    if (platform === 'ios') {
      await bootIosSimulator()
    } else {
      await bootAndroidEmulator()
    }

    // 2. Build if needed
    const [rebuildNeeded, reason] = needsRebuild(target, { forceRebuild })
    if (rebuildNeeded) {
      console.log(`🔨 Build needed: ${reason}`)
      if (platform === 'ios') {
        await buildIos()
      } else {
        await buildAndroid()
      }
    } else {
      console.log(`✅ Using cached build (${reason})`)
    }

    // 3. Install app
    if (platform === 'ios') {
      await installIosApp()
    } else {
      await installAndroidApp()
    }

    // 4. Start Metro
    await ensureMetroRunning()

    // 5. Run E2E test
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

    const maestroArgs = [
      '--platform', platform,
      'test', flowPath,
      '--output', OUTPUT_DIR
    ]

    if (process.env.E2E_CONNECT_KEY) {
      maestroArgs.push('-e', `E2E_CONNECT_KEY=${process.env.E2E_CONNECT_KEY}`)
    }

    if (process.env.E2E_INDEXER_URL) {
      maestroArgs.push('-e', `E2E_INDEXER_URL=${process.env.E2E_INDEXER_URL}`)
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
