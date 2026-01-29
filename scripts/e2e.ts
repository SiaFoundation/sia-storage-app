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

import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { $ } from 'bun'
import { buildAndroid, buildIosSim } from './build'
import {
  type BuildTarget,
  getTargetPaths,
  needsRebuild,
  PROJECT_ROOT,
} from './buildCache'

const E2E_DIR = join(PROJECT_ROOT, 'e2e')
const FLOWS_DIR = join(E2E_DIR, 'flows')
const OUTPUT_DIR = join(E2E_DIR, '.maestro/tests')

// App bundle IDs
const IOS_BUNDLE_ID = 'sia.storage.dev'
const ANDROID_PACKAGE = 'sia.storage.dev'

// Dedicated E2E device names (to avoid affecting developer's main devices)
const E2E_IOS_DEVICE_NAME = 'E2E-iPhone-16-Pro'
const E2E_IOS_DEVICE_TYPE = 'iPhone 16 Pro'
const E2E_ANDROID_AVD_NAME = 'E2E_Medium_Phone'

// Parse args
const args = process.argv.slice(2)
const platformArg = args.find((a) => a === 'ios' || a === 'android')
const flow = args.find((a) => a.endsWith('.yml')) // undefined = run all flows
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
  console.error(
    'If no flow.yml is specified, all flows in test/e2e/flows/ will be run.',
  )
  console.error('')
  console.error('Flags:')
  console.error(
    '  --rebuild         Full clean build (delete platform dir, prebuild, build)',
  )
  console.error('  --skip-install  Skip app installation')
  console.error('  --headless      Run simulator/emulator without UI')
  console.error('')
  console.error('Examples:')
  console.error(
    '  bun scripts/e2e.ts ios                    # Run all flows on iOS',
  )
  console.error(
    '  bun scripts/e2e.ts ios onboarding.yml     # Run specific flow',
  )
  console.error('  E2E_CONNECT_KEY="..." bun scripts/e2e.ts android')
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

// Get or create the E2E iOS Simulator
async function getOrCreateE2ESimulator(): Promise<string> {
  // Check if E2E simulator already exists
  const listResult = await $`xcrun simctl list devices`.quiet().nothrow()
  const listOutput = listResult.stdout.toString()

  // Look for our E2E simulator by name
  const existingMatch = listOutput.match(
    new RegExp(`${E2E_IOS_DEVICE_NAME}\\s*\\(([A-F0-9-]+)\\)`, 'i'),
  )
  if (existingMatch) {
    return existingMatch[1]
  }

  // Create the E2E simulator
  console.log(`📱 Creating E2E iOS Simulator: ${E2E_IOS_DEVICE_NAME}...`)

  // Get the latest iOS runtime
  const runtimeResult = await $`xcrun simctl list runtimes iOS`
    .quiet()
    .nothrow()
  const runtimeMatch = runtimeResult.stdout
    .toString()
    .match(
      /iOS[^(]*\(([^)]+)\)\s*-\s*(com\.apple\.CoreSimulator\.SimRuntime\.iOS[^\s]+)/i,
    )
  if (!runtimeMatch) throw new Error('No iOS runtime found')
  const runtimeId = runtimeMatch[2]

  // Get the device type ID
  const deviceTypeResult = await $`xcrun simctl list devicetypes`
    .quiet()
    .nothrow()
  const deviceTypeMatch = deviceTypeResult.stdout
    .toString()
    .match(new RegExp(`${E2E_IOS_DEVICE_TYPE}\\s*\\(([^)]+)\\)`, 'i'))
  if (!deviceTypeMatch)
    throw new Error(`Device type ${E2E_IOS_DEVICE_TYPE} not found`)
  const deviceTypeId = deviceTypeMatch[1]

  // Create the simulator
  const createResult =
    await $`xcrun simctl create ${E2E_IOS_DEVICE_NAME} ${deviceTypeId} ${runtimeId}`
      .quiet()
      .nothrow()
  const udid = createResult.stdout.toString().trim()

  if (!udid || udid.length < 30) {
    throw new Error(
      `Failed to create E2E simulator: ${createResult.stderr.toString()}`,
    )
  }

  console.log(`   Created: ${udid}`)
  return udid
}

// Check if our E2E iOS simulator is booted
async function isE2ESimulatorBooted(udid: string): Promise<boolean> {
  const result = await $`xcrun simctl list devices booted`.quiet().nothrow()
  return result.stdout.toString().includes(udid)
}

// Get booted E2E iOS simulator UDID (for compatibility with existing code)
async function getIosSimulatorUdid(): Promise<string | null> {
  const udid = await getOrCreateE2ESimulator()
  return udid
}

// Get Android emulator serial
async function getAndroidEmulatorSerial(): Promise<string | null> {
  const result = await $`adb devices`.quiet().nothrow()
  const output = result.stdout.toString()
  // Match: emulator-5554	device
  const match = output.match(/(emulator-\d+)\s+device/)
  return match ? match[1] : null
}

// Clear iOS Simulator photo library by deleting Photos database directly
// This removes stock photos that come with simulators, unlike simctl erase
async function clearIosPhotoLibrary(): Promise<void> {
  const udid = await getIosSimulatorUdid()
  if (!udid) return

  console.log('🧹 Clearing iOS photo library...')

  // Shutdown simulator first
  await $`xcrun simctl shutdown ${udid}`.quiet().nothrow()

  // Delete the Photos library database directly
  // This removes stock photos that simctl erase doesn't clear
  await $`rm -rf ~/Library/Developer/CoreSimulator/Devices/${udid}/data/Media/DCIM/*`
    .quiet()
    .nothrow()
  await $`rm -rf ~/Library/Developer/CoreSimulator/Devices/${udid}/data/Media/PhotoData/*`
    .quiet()
    .nothrow()

  // Boot simulator back up
  await $`xcrun simctl boot ${udid}`.quiet().nothrow()

  // Wait for simulator to fully boot
  await new Promise((resolve) => setTimeout(resolve, 5000))
}

// Clear Android emulator photo library
// Clears both the media database and files to remove stock photos
async function clearAndroidPhotoLibrary(): Promise<void> {
  console.log('🧹 Clearing Android photo library...')

  // Clear media database directly (removes all photo entries including stock)
  await $`adb shell content delete --uri content://media/external/images/media`
    .quiet()
    .nothrow()

  // Also delete files from common directories
  await $`adb shell "find /sdcard/DCIM -type f -delete 2>/dev/null || true"`
    .quiet()
    .nothrow()
  await $`adb shell "find /sdcard/Pictures -type f -delete 2>/dev/null || true"`
    .quiet()
    .nothrow()
  await $`adb shell "find /sdcard/Download -name '*.png' -o -name '*.jpg' -delete 2>/dev/null || true"`
    .quiet()
    .nothrow()

  // Trigger media scanner to update
  await $`adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/DCIM`
    .quiet()
    .nothrow()

  // Give it time to process
  await new Promise((resolve) => setTimeout(resolve, 2000))
}

// Boot E2E iOS simulator
async function bootIosSimulator(): Promise<void> {
  const udid = await getOrCreateE2ESimulator()

  if (await isE2ESimulatorBooted(udid)) {
    console.log(`📱 E2E iOS Simulator already running (${E2E_IOS_DEVICE_NAME})`)
    return
  }

  console.log(
    `📱 Booting E2E iOS Simulator: ${E2E_IOS_DEVICE_NAME}${headless ? ' (headless)' : ''}...`,
  )

  await $`xcrun simctl boot ${udid}`

  // Open Simulator.app unless headless
  if (!headless) {
    await $`open -a Simulator`.nothrow()
  }

  // Wait for boot
  await new Promise((resolve) => setTimeout(resolve, 5000))
}

// Check if our E2E Android emulator is running
async function _isE2EAndroidEmulatorRunning(): Promise<boolean> {
  // Check if any emulator is running and get its AVD name
  const result = await $`adb shell getprop ro.boot.qemu.avd_name 2>/dev/null`
    .quiet()
    .nothrow()
  const avdName = result.stdout.toString().trim()
  return avdName === E2E_ANDROID_AVD_NAME
}

// Check if Android AVD exists
async function e2eAndroidAvdExists(): Promise<boolean> {
  const result = await $`emulator -list-avds`.quiet().nothrow()
  const avds = result.stdout.toString().trim().split('\n').filter(Boolean)
  return avds.includes(E2E_ANDROID_AVD_NAME)
}

// Boot E2E Android emulator
async function bootAndroidEmulator(): Promise<void> {
  // Check if our E2E emulator is running
  const anyEmulatorResult =
    await $`adb shell getprop sys.boot_completed 2>/dev/null`.quiet().nothrow()
  const anyEmulatorRunning = anyEmulatorResult.stdout.toString().trim() === '1'

  if (anyEmulatorRunning) {
    // Check if it's our E2E emulator
    const avdNameResult =
      await $`adb shell getprop ro.boot.qemu.avd_name 2>/dev/null`
        .quiet()
        .nothrow()
    const runningAvd = avdNameResult.stdout.toString().trim()

    if (runningAvd === E2E_ANDROID_AVD_NAME) {
      console.log(
        `🤖 E2E Android Emulator already running (${E2E_ANDROID_AVD_NAME})`,
      )
      return
    } else {
      console.log(
        `⚠️  Different emulator running (${runningAvd}), need E2E emulator (${E2E_ANDROID_AVD_NAME})`,
      )
      console.log(
        `   Please close the current emulator and run again, or create the E2E AVD`,
      )
    }
  }

  // Check if E2E AVD exists
  if (!(await e2eAndroidAvdExists())) {
    console.error(`\n❌ E2E Android AVD not found: ${E2E_ANDROID_AVD_NAME}`)
    console.error(`\nTo create it, run in Android Studio:`)
    console.error(`  1. Tools > Device Manager > Create Device`)
    console.error(`  2. Select "Medium Phone" and click Next`)
    console.error(`  3. Select an API 34+ image and click Next`)
    console.error(`  4. Name the AVD: ${E2E_ANDROID_AVD_NAME}`)
    console.error(`  5. Click Finish`)
    console.error(
      `\nOr run: avdmanager create avd -n ${E2E_ANDROID_AVD_NAME} -k "system-images;android-34;google_apis;arm64-v8a" -d "Medium Phone"`,
    )
    process.exit(1)
  }

  console.log(`🤖 Booting E2E Android Emulator: ${E2E_ANDROID_AVD_NAME}...`)

  // Start emulator in background
  const emulatorArgs = headless
    ? `-avd ${E2E_ANDROID_AVD_NAME} -no-window -no-audio -no-boot-anim`
    : `-avd ${E2E_ANDROID_AVD_NAME}`

  Bun.spawn(['sh', '-c', `emulator ${emulatorArgs} &`], {
    stdout: 'ignore',
    stderr: 'ignore',
  })

  // Wait for boot
  console.log('   Waiting for emulator to boot...')
  await $`adb wait-for-device`

  for (let i = 0; i < 60; i++) {
    const result = await $`adb shell getprop sys.boot_completed 2>/dev/null`
      .quiet()
      .nothrow()
    if (result.stdout.toString().trim() === '1') break
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }

  console.log('   Emulator booted')
}

// Find iOS app path
async function findIosApp(): Promise<string> {
  if (!existsSync(paths.derivedData)) {
    throw new Error('iOS app not found. Run with --rebuild')
  }

  const result =
    await $`find ${paths.derivedData} -name "*.app" -path "*Debug-iphonesimulator*" -type d 2>/dev/null`
      .quiet()
      .nothrow()
  const found = result.stdout.toString().trim().split('\n').filter(Boolean)[0]
  if (!found) {
    throw new Error('iOS app not found in DerivedData. Run with --rebuild')
  }
  return found
}

// Find Android APK path
async function findAndroidApk(): Promise<string> {
  const androidDir = join(PROJECT_ROOT, 'android')
  const result =
    await $`find ${androidDir} -name "*.apk" -path "*debug*" 2>/dev/null`
      .quiet()
      .nothrow()
  const apkPath = result.stdout.toString().trim().split('\n').filter(Boolean)[0]
  if (!apkPath) throw new Error('Android APK not found. Run with --rebuild')
  return apkPath
}

// Check if iOS app is installed on specific simulator
async function isIosAppInstalled(udid: string): Promise<boolean> {
  const result = await $`xcrun simctl listapps ${udid} 2>/dev/null`
    .quiet()
    .nothrow()
  return result.stdout.toString().includes(IOS_BUNDLE_ID)
}

// Check if Android app is installed on emulator
async function isAndroidAppInstalled(): Promise<boolean> {
  const result =
    await $`adb shell pm list packages ${ANDROID_PACKAGE} 2>/dev/null`
      .quiet()
      .nothrow()
  return result.stdout.toString().includes(ANDROID_PACKAGE)
}

// Install iOS app on specific simulator
async function installIosApp(udid: string): Promise<void> {
  if (skipInstall) {
    console.log('📲 Skipping iOS app install (--skip-install)')
    return
  }

  if (await isIosAppInstalled(udid)) {
    console.log('📲 iOS app already installed')
    return
  }

  console.log('📲 Installing iOS app...')
  const appPath = await findIosApp()
  await $`xcrun simctl install ${udid} ${appPath}`
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
    await new Promise((resolve) => setTimeout(resolve, 2000))
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
    .filter((f) => {
      const dir = join(OUTPUT_DIR, f)
      return existsSync(dir) && readdirSync(dir).some((f) => f.endsWith('.png'))
    })
    .sort()
    .reverse()
  return folders.length > 0 ? join(OUTPUT_DIR, folders[0]) : null
}

// Main
async function main() {
  console.log(`\n🚀 E2E Test Runner`)
  console.log(`   Platform: ${platform}`)
  console.log(`   Flow: ${flow || 'all flows'}`)
  console.log(`   Cache: .build-cache/${target}/`)
  console.log(
    `   Flags: ${[forceRebuild && '--rebuild', skipInstall && '--skip-install', headless && '--headless'].filter(Boolean).join(' ') || 'none'}`,
  )
  console.log('')

  try {
    // 1. Boot device and get device ID
    let deviceId: string
    if (platform === 'ios') {
      await bootIosSimulator()
      const udid = await getIosSimulatorUdid()
      if (!udid) {
        throw new Error(
          'Could not get iOS Simulator UDID. Is the simulator running?',
        )
      }
      deviceId = udid
    } else {
      await bootAndroidEmulator()
      const serial = await getAndroidEmulatorSerial()
      if (!serial) {
        throw new Error(
          'Could not get Android emulator serial. Is the emulator running?',
        )
      }
      deviceId = serial
    }

    // 2. Clear photo library for test isolation
    if (platform === 'ios') {
      await clearIosPhotoLibrary()
    } else {
      await clearAndroidPhotoLibrary()
    }

    // 3. Build if needed
    const [rebuildNeeded, reason] = needsRebuild(target, {
      forceRebuild: forceRebuild,
    })
    if (rebuildNeeded || forceRebuild) {
      console.log(
        `🔨 Build needed: ${forceRebuild ? '--rebuild requested' : reason}`,
      )
      if (platform === 'ios') {
        await buildIosSim({ target, alwaysClean: forceRebuild })
      } else {
        await buildAndroid({ target, alwaysClean: forceRebuild })
      }
    } else {
      console.log(`✅ Using cached build (${reason})`)
    }

    // 4. Install app
    if (platform === 'ios') {
      await installIosApp(deviceId)
    } else {
      await installAndroidApp()
    }

    // 5. Start Metro
    await ensureMetroRunning()

    // 6. Run E2E test(s)
    const env = {
      ...process.env,
      PATH: `${process.env.PATH}:${process.env.HOME}/.maestro/bin`,
      MAESTRO_DRIVER_STARTUP_TIMEOUT: '300000',
      MAESTRO_CLI_NO_ANALYTICS: '1',
      MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: 'true',
    }

    // Get list of flows to run
    const flowsToRun: string[] = []
    if (flow) {
      const flowPath = join(FLOWS_DIR, flow)
      if (!existsSync(flowPath)) {
        throw new Error(`Flow not found: ${flowPath}`)
      }
      flowsToRun.push(flow)
    } else {
      // Run all flows in the flows directory
      const allFlows = readdirSync(FLOWS_DIR)
        .filter((f) => f.endsWith('.yml'))
        .sort()
      flowsToRun.push(...allFlows)
    }

    console.log(`\n🧪 Running E2E tests: ${flowsToRun.length} flow(s)\n`)

    let passed = 0
    let failed = 0
    const failedFlows: string[] = []

    for (const flowFile of flowsToRun) {
      const flowPath = join(FLOWS_DIR, flowFile)
      console.log(`\n▶️  Running: ${flowFile}`)

      // Always specify device to avoid running on wrong platform
      // --device is a global flag that must come BEFORE the 'test' subcommand
      const maestroArgs = [
        '--device',
        deviceId,
        'test',
        flowPath,
        '--output',
        OUTPUT_DIR,
      ]
      if (process.env.E2E_CONNECT_KEY) {
        maestroArgs.push('-e', `E2E_CONNECT_KEY=${process.env.E2E_CONNECT_KEY}`)
      }

      const result = await $`maestro ${maestroArgs}`.env(env).nothrow()

      if (result.exitCode !== 0) {
        console.log(`   ❌ ${flowFile} failed`)
        failed++
        failedFlows.push(flowFile)
      } else {
        console.log(`   ✅ ${flowFile} passed`)
        passed++
      }
    }

    // Summary
    console.log(`\n${'─'.repeat(50)}`)
    console.log(`📊 Results: ${passed} passed, ${failed} failed`)

    if (failed > 0) {
      console.log(`\n❌ Failed flows:`)
      for (const f of failedFlows) {
        console.log(`   - ${f}`)
      }
      const screenshotDir = findLatestScreenshots()
      if (screenshotDir) {
        console.log(`\n📸 Screenshots: ${screenshotDir}`)
      }
      stopMetro()
      process.exit(1)
    }

    console.log('\n✅ All E2E tests passed!')
    stopMetro()
    process.exit(0)
  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : error)
    stopMetro()
    process.exit(1)
  }
}

main()
