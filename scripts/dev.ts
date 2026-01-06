#!/usr/bin/env bun
/**
 * Smart Development Build Runner
 *
 * Usage:
 *   bun scripts/dev.ts ios          # Build & run on iOS Simulator
 *   bun scripts/dev.ts ios:device   # Build & run on real iOS device
 *   bun scripts/dev.ts android      # Build & run on Android emulator/device
 *
 * Flags:
 *   --rebuild    Force a fresh build (ignore cache)
 *   --no-run     Build only, don't launch the app
 *   --clean      Full clean build (rimraf + prebuild + build)
 *
 * How caching works:
 *   - Computes hash from package.json, bun.lock, app.config.js, eas.json, plugins/*.js
 *   - Each target (ios, ios:device, android) has isolated cache in .build-cache/
 *   - Skips rebuild if hash matches and artifacts exist
 *   - Use --rebuild to force rebuild, --clean for full clean build
 *
 * Cache locations:
 *   .build-cache/ios-sim/       - iOS Simulator builds
 *   .build-cache/ios-device/    - iOS device builds
 *   .build-cache/android/       - Android builds
 */

import { $ } from 'bun'
import { existsSync, rmSync } from 'fs'
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
} from './buildCache'

// Parse arguments
const args = process.argv.slice(2)
const targetArg = args.find(a => !a.startsWith('-'))
const forceRebuild = args.includes('--rebuild')
const noRun = args.includes('--no-run')
const cleanBuild = args.includes('--clean')

// Map CLI arg to build target
function getTarget(): BuildTarget {
  switch (targetArg) {
    case 'ios':
    case 'ios:sim':
      return 'ios-sim'
    case 'ios:device':
      return 'ios-device'
    case 'android':
      return 'android'
    default:
      console.error('Usage: bun scripts/dev.ts <target> [flags]')
      console.error('')
      console.error('Targets:')
      console.error('  ios          Build & run on iOS Simulator')
      console.error('  ios:device   Build & run on real iOS device')
      console.error('  android      Build & run on Android emulator/device')
      console.error('')
      console.error('Flags:')
      console.error('  --rebuild    Force a fresh build (ignore cache)')
      console.error('  --no-run     Build only, don\'t launch the app')
      console.error('  --clean      Full clean build (rimraf + prebuild + build)')
      process.exit(1)
  }
}

const target = getTarget()
const platform = target.includes('ios') ? 'ios' : 'android'
const isDevice = target === 'ios-device'
const paths = getTargetPaths(target)

// Print header
console.log(`\n🚀 Smart Dev Build`)
console.log(`   Target: ${targetArg}`)
console.log(`   Flags: ${[forceRebuild && '--rebuild', noRun && '--no-run', cleanBuild && '--clean'].filter(Boolean).join(' ') || 'none'}`)
console.log(`   Cache: .build-cache/${target}/`)
console.log('')

$.cwd(PROJECT_ROOT)

// Clean build: wipe everything and start fresh
if (cleanBuild) {
  console.log('🧹 Clean build requested')
  console.log(`   Removing ${platform}/...`)
  rmSync(join(PROJECT_ROOT, platform), { recursive: true, force: true })
  console.log(`   Removing .build-cache/${target}/...`)
  rmSync(paths.dir, { recursive: true, force: true })
  console.log('')
}

// Check if rebuild needed
const [rebuildNeeded, reason] = needsRebuild(target, { forceRebuild: forceRebuild || cleanBuild })

if (rebuildNeeded) {
  console.log(`🔨 Build needed: ${reason}`)
  ensureCacheDir(target)

  // Prebuild if platform directory doesn't exist
  const platformDir = join(PROJECT_ROOT, platform)
  if (!existsSync(platformDir)) {
    console.log(`   Prebuilding ${platform}...`)
    const prebuildResult = await $`bunx expo prebuild --platform ${platform} 2>&1`.quiet().nothrow()
    writeBuildLog(target, `=== PREBUILD ===\n${prebuildResult.stdout}\n`)

    if (prebuildResult.exitCode !== 0) {
      console.error('❌ Prebuild failed. Last 30 lines:')
      console.error(getBuildLogTail(target, 30))
      process.exit(1)
    }
  }

  // Platform-specific build
  if (platform === 'ios') {
    await buildIos()
  } else {
    await buildAndroid()
  }

  saveBuildHash(target)
  console.log('✅ Build complete')
} else {
  console.log(`✅ Using cached build (${reason})`)
}

// Run the app unless --no-run
if (!noRun) {
  console.log('')
  if (platform === 'ios') {
    await runIos()
  } else {
    await runAndroid()
  }
}

// === iOS Build ===
async function buildIos(): Promise<void> {
  console.log(`   Building iOS (${isDevice ? 'device' : 'simulator'})...`)
  console.log(`   Build log: ${paths.buildLog}`)

  if (isDevice) {
    // Device build via fastlane
    const buildResult = await $`fastlane ios dev_device 2>&1`.quiet().nothrow()
    writeBuildLog(target, `=== FASTLANE ===\n${buildResult.stdout}`, true)

    if (buildResult.exitCode !== 0) {
      console.error('❌ Build failed. Last 50 lines:')
      console.error(getBuildLogTail(target, 50))
      throw new Error('iOS device build failed')
    }
  } else {
    // Simulator build via xcodebuild with dedicated DerivedData
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
      throw new Error('iOS simulator build failed')
    }
  }
}

// === Android Build ===
async function buildAndroid(): Promise<void> {
  console.log('   Building Android...')
  console.log(`   Build log: ${paths.buildLog}`)

  $.cwd(join(PROJECT_ROOT, 'android'))
  const buildResult = await $`./gradlew assembleDebug --no-daemon 2>&1`.quiet().nothrow()
  $.cwd(PROJECT_ROOT)

  writeBuildLog(target, `=== GRADLE ===\n${buildResult.stdout}`, true)

  if (buildResult.exitCode !== 0 || buildResult.stdout.toString().includes('BUILD FAILED')) {
    console.error('❌ Build failed. Last 50 lines:')
    console.error(getBuildLogTail(target, 50))
    throw new Error('Android build failed')
  }
}

// === Run iOS App ===
async function runIos(): Promise<void> {
  if (isDevice) {
    console.log('📱 Running on iOS device...')
    // For device, we typically use ios-deploy or the app was installed by fastlane
    console.log('   App should be installed on device. Open it manually or use ios-deploy.')
  } else {
    console.log('📱 Running on iOS Simulator...')

    // Find the built app
    const appPath = await findIosSimApp()
    if (!appPath) {
      console.error('❌ Could not find built app')
      process.exit(1)
    }

    // Boot simulator if needed
    const bootedResult = await $`xcrun simctl list devices booted`.quiet().nothrow()
    if (!bootedResult.stdout.toString().includes('iPhone')) {
      console.log('   Booting simulator...')
      const devices = await $`xcrun simctl list devices available`.text()
      const match = devices.match(/iPhone[^(]*\(([^)]+)\)/)
      if (match) {
        await $`xcrun simctl boot ${match[1]}`.quiet().nothrow()
        await $`open -a Simulator`.nothrow()
      }
    }

    // Install and launch
    console.log('   Installing app...')
    await $`xcrun simctl install booted ${appPath}`.quiet()
    console.log('   Launching app...')
    await $`xcrun simctl launch booted sia.storage.dev`.quiet()
    console.log('✅ App launched')
  }
}

// === Run Android App ===
async function runAndroid(): Promise<void> {
  console.log('🤖 Running on Android...')

  // Find APK
  const apkDir = join(PROJECT_ROOT, 'android/app/build/outputs/apk/debug')
  const apkResult = await $`find ${apkDir} -name "*.apk" 2>/dev/null`.quiet().nothrow()
  const apkPath = apkResult.stdout.toString().trim().split('\n').filter(Boolean)[0]

  if (!apkPath) {
    console.error('❌ Could not find APK')
    process.exit(1)
  }

  // Check for connected device/emulator
  const devices = await $`adb devices`.quiet()
  if (!devices.stdout.toString().includes('\tdevice')) {
    console.log('   No device connected. Starting emulator...')
    const avdsResult = await $`emulator -list-avds`.quiet().nothrow()
    const avds = avdsResult.stdout.toString().trim().split('\n').filter(Boolean)
    if (avds.length === 0) {
      console.error('❌ No Android emulator found. Create one in Android Studio.')
      process.exit(1)
    }
    Bun.spawn(['sh', '-c', `emulator -avd ${avds[0]} &`], { stdout: 'ignore', stderr: 'ignore' })
    console.log('   Waiting for emulator...')
    await $`adb wait-for-device`
    // Wait for boot
    for (let i = 0; i < 60; i++) {
      const bootResult = await $`adb shell getprop sys.boot_completed 2>/dev/null`.quiet().nothrow()
      if (bootResult.stdout.toString().trim() === '1') break
      await new Promise(r => setTimeout(r, 2000))
    }
  }

  // Install and launch
  console.log('   Installing APK...')
  await $`adb install -r ${apkPath}`.quiet()
  console.log('   Launching app...')
  await $`adb shell am start -n sia.storage.dev/.MainActivity`.quiet()
  console.log('✅ App launched')
}

// Find iOS Simulator app in DerivedData
async function findIosSimApp(): Promise<string | null> {
  const result = await $`find ${paths.derivedData} -name "*.app" -path "*Debug-iphonesimulator*" -type d 2>/dev/null`.quiet().nothrow()
  const found = result.stdout.toString().trim().split('\n').filter(Boolean)[0]
  return found || null
}
