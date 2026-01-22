#!/usr/bin/env bun
/**
 * E2E Test Runner
 *
 * Runs Maestro E2E tests with smart build caching.
 *
 * Usage:
 *   bun scripts/e2e.ts ios              # Run on iOS Simulator
 *   bun scripts/e2e.ts android          # Run on Android emulator
 *   bun scripts/e2e.ts ios flow.yml     # Run specific flow
 *
 * Flags:
 *   --rebuild         Full clean build (delete platform dir, prebuild, build)
 *   --skip-install  Skip app installation (if already installed)
 *   --headless      Run simulator/emulator without UI window
 *
 * Environment:
 *   E2E_CONNECT_KEY - App password for indexer auth (required for auth tests)
 *
 * How caching works:
 *   - Uses shared build cache from scripts/buildCache.ts
 *   - E2E uses same builds as dev (.build-cache/ios-sim/ and .build-cache/android/)
 *   - No rebuild needed when switching between dev and e2e
 */

import { $ } from 'bun'
import { existsSync, readdirSync, mkdirSync } from 'fs'
import { join } from 'path'
import {
  PROJECT_ROOT,
  type BuildTarget,
  getTargetPaths,
  needsRebuild,
} from './buildCache'
import { buildIosSim, buildAndroid } from './build'

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
  console.error('Usage: bun scripts/e2e.ts <platform> [flow.yml] [flags]')
  console.error('')
  console.error('Platforms:')
  console.error('  ios       Run on iOS Simulator')
  console.error('  android   Run on Android emulator')
  console.error('')
  console.error('Flags:')
  console.error('  --rebuild         Full clean build (delete platform dir, prebuild, build)')
  console.error('  --skip-install  Skip app installation')
  console.error('  --headless      Run simulator/emulator without UI')
  console.error('')
  console.error('Example:')
  console.error('  E2E_CONNECT_KEY="..." bun scripts/e2e.ts ios onboarding.yml')
  process.exit(1)
}

const platform = platformArg
// Use same build target as dev - builds are identical now that E2E_TEST flag is removed
const target: BuildTarget = platform === 'android' ? 'android' : 'ios-sim'

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

// Track Metro process if we started it
let metroProcess: ReturnType<typeof Bun.spawn> | null = null

// Start Metro if not running, returns true if we started it
async function ensureMetroRunning(): Promise<boolean> {
  if (await isMetroRunning()) {
    console.log('🚇 Metro already running')
    return false
  }

  console.log('🚇 Starting Metro...')

  metroProcess = Bun.spawn(['bun', 'run', 'start'], {
    cwd: PROJECT_ROOT,
    stdout: 'ignore',
    stderr: 'ignore',
  })

  // Wait for Metro to be ready
  for (let i = 0; i < 60; i++) {
    if (await isMetroRunning()) {
      console.log('✅ Metro ready')
      return true
    }
    await new Promise(resolve => setTimeout(resolve, 2000))
  }

  throw new Error('Metro failed to start')
}

// Stop Metro if we started it
function stopMetro(): void {
  if (metroProcess) {
    console.log('🚇 Stopping Metro...')
    metroProcess.kill()
    metroProcess = null
  }
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
    const [rebuildNeeded, reason] = needsRebuild(target, { forceRebuild: forceRebuild })
    if (rebuildNeeded || forceRebuild) {
      console.log(`🔨 Build needed: ${forceRebuild ? '--rebuild requested' : reason}`)
      if (platform === 'ios') {
        await buildIosSim({ target, alwaysClean: forceRebuild })
      } else {
        await buildAndroid({ target, alwaysClean: forceRebuild })
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
      stopMetro()
      process.exit(result.exitCode)
    }

    console.log('\n✅ E2E test passed!')
    stopMetro()
    process.exit(0)

  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : error)
    stopMetro()
    process.exit(1)
  }
}

main()
