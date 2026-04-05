#!/usr/bin/env bun

/**
 * Smart Development Build Runner
 *
 * Usage:
 *   bun scripts/dev.ts ios:simulator    # Build & run on iOS Simulator
 *   bun scripts/dev.ts ios:device       # Build & run on real iOS device
 *   bun scripts/dev.ts android:emulator # Build & run on Android emulator
 *   bun scripts/dev.ts android:device   # Build & run on real Android device
 *
 * Flags:
 *   --rebuild    Full clean build (delete platform dir, prebuild, build)
 *   --no-run     Build only, don't launch the app
 *   --release    Build with Release config (bundles JS, no dev server needed)
 *
 * How caching works:
 *   - Computes hash from package.json, bun.lock, app.config.js, eas.json, plugins/*.js
 *   - Each target has isolated cache in .build-cache/
 *   - Skips rebuild if hash matches and artifacts exist
 *
 * Cache locations:
 *   .build-cache/ios-sim/            - iOS Simulator builds
 *   .build-cache/ios-device/         - iOS device builds (debug)
 *   .build-cache/ios-device-release/ - iOS device builds (release)
 *   .build-cache/android/            - Android builds (debug, shared by emulator and device)
 *   .build-cache/android-release/    - Android release builds
 */

import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { $ } from 'bun'
import { buildAndroid, buildIosDevice, buildIosSim, findIosDeviceApp } from './build'
import { type BuildTarget, getTargetPaths, needsRebuild, PROJECT_ROOT } from './buildCache'
import { confirmRebuild } from './lib/confirm'
import {
  type Device,
  installAndroidApp,
  installIosApp,
  launchAndroidApp,
  launchIosApp,
  listDevices,
  selectAndroidDevice,
  selectAndroidEmulator,
  selectDevice,
} from './lib/devices'
import { waitForDeviceUnlock } from './lib/ui'

// Parse arguments
const args = process.argv.slice(2)
const targetArg = args.find((a) => !a.startsWith('-'))
const forceRebuild = args.includes('--rebuild')
const noRun = args.includes('--no-run')
const release = args.includes('--release')

// Map CLI arg to build target
function getTarget(): BuildTarget {
  switch (targetArg) {
    case 'ios:simulator':
    case 'ios:sim':
      return 'ios-sim'
    case 'ios:device':
      return release ? 'ios-device-release' : 'ios-device'
    case 'android:emulator':
    case 'android:emu':
      return release ? 'android-release' : 'android'
    case 'android:device':
      return release ? 'android-release' : 'android'
    default:
      console.error('Usage: bun scripts/dev.ts <target> [flags]')
      console.error('')
      console.error('Targets:')
      console.error('  ios:simulator    Build & run on iOS Simulator')
      console.error('  ios:device       Build & run on real iOS device')
      console.error('  android:emulator Build & run on Android emulator')
      console.error('  android:device   Build & run on real Android device')
      console.error('')
      console.error('Flags:')
      console.error('  --rebuild    Full clean build (delete platform dir, prebuild, build)')
      console.error("  --no-run     Build only, don't launch the app")
      console.error('  --release    Build with Release config (standalone, no dev server)')
      process.exit(1)
  }
}

const target = getTarget()
const platform = target.includes('ios') ? 'ios' : 'android'
const isDevice =
  target === 'ios-device' || target === 'ios-device-release' || targetArg === 'android:device'
const paths = getTargetPaths(target)

// Print header
console.log(`\n🚀 Smart Dev Build`)
console.log(`   Target: ${targetArg}`)
console.log(
  `   Flags: ${[forceRebuild && '--rebuild', noRun && '--no-run', release && '--release'].filter(Boolean).join(' ') || 'none'}`,
)
console.log(`   Cache: .build-cache/${target}/`)
console.log('')

$.cwd(PROJECT_ROOT)

// Full rebuild: confirm, then wipe everything and start fresh
if (forceRebuild) {
  confirmRebuild(platform)
  console.log('🔨 Full rebuild requested')
  console.log(`   Removing ${platform}/...`)
  rmSync(join(PROJECT_ROOT, platform), { recursive: true, force: true })
  console.log(`   Removing .build-cache/${target}/...`)
  rmSync(paths.dir, { recursive: true, force: true })
  console.log('')
}

// For iOS device builds, check for connected device first (before building)
let selectedDevice: Device | null = null
if (target === 'ios-device' || target === 'ios-device-release') {
  console.log('📱 Checking for iOS device...')
  selectedDevice = await selectDevice('ios', 'device')

  if (!selectedDevice) {
    console.error('')
    console.error('   No iOS device connected')
    console.error('')
    console.error('   Please connect your iPhone with a USB cable and unlock it.')
    console.error('   Run `xcrun devicectl list devices` to verify.')
    process.exit(1)
  }

  console.log(`   Found: ${selectedDevice.name}`)
  console.log('')
}

// Release builds always rebuild to ensure the JS bundle is fresh.
// Debug builds use the cache since JS loads from Metro.
const [rebuildNeeded, reason] = release
  ? [true, 'release build (always rebuilds)']
  : needsRebuild(target, { forceRebuild })

if (rebuildNeeded) {
  console.log(`🔨 Build needed: ${reason}`)

  // Platform-specific build
  if (platform === 'ios') {
    if (isDevice) {
      await buildIosDevice({ target, release })
    } else {
      await buildIosSim({ target })
    }
  } else {
    await buildAndroid({ target, release })
  }

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

// === Run iOS App ===
async function runIos(): Promise<void> {
  if (isDevice) {
    await runIosDevice()
  } else {
    await runIosSimulator()
  }
}

// === Run iOS on Physical Device ===
async function runIosDevice(): Promise<void> {
  console.log('📱 Installing on iOS device...')

  // Find the built app
  const appPath = await findIosDeviceApp(target, { release })
  if (!appPath) {
    console.error('   Could not find built app')
    process.exit(1)
  }

  // Get fresh device list (in case state changed)
  const device = await selectDevice('ios', 'device')
  if (!device) {
    console.error('   Device disconnected')
    process.exit(1)
  }

  // Install with retry loop for device unlock
  while (true) {
    const installResult = await installIosApp(device, appPath)

    if (installResult.success) {
      console.log('   Installed successfully')
      break
    }

    if (installResult.error === 'locked') {
      await waitForDeviceUnlock(device.name)
      continue
    }

    console.error(`   Install failed: ${installResult.message}`)
    process.exit(1)
  }

  // Launch the app
  console.log('🚀 Launching app...')
  const bundleId = 'sia.storage.dev'

  while (true) {
    const launchResult = await launchIosApp(device, bundleId)

    if (launchResult.success) {
      console.log('✅ App launched')
      break
    }

    if (launchResult.error === 'locked') {
      await waitForDeviceUnlock(device.name)
      continue
    }

    console.error(`   Launch failed: ${launchResult.message}`)
    process.exit(1)
  }
}

// === Run iOS on Simulator ===
async function runIosSimulator(): Promise<void> {
  console.log('📱 Running on iOS Simulator...')

  // Find the built app
  const appPath = await findIosSimApp()
  if (!appPath) {
    console.error('   Could not find built app')
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

// === Run Android App ===
async function runAndroid(): Promise<void> {
  if (isDevice) {
    await runAndroidDevice()
  } else {
    await runAndroidEmulator()
  }
}

// Find Android APK
async function findAndroidApk(): Promise<string> {
  const apkVariant = release ? 'release' : 'debug'
  const apkDir = join(PROJECT_ROOT, `android/app/build/outputs/apk/${apkVariant}`)
  const apkResult = await $`find ${apkDir} -name "*.apk" 2>/dev/null`.quiet().nothrow()
  const apkPath = apkResult.stdout.toString().trim().split('\n').filter(Boolean)[0]

  if (!apkPath) {
    console.error('   Could not find APK')
    process.exit(1)
  }
  return apkPath
}

// Install and launch Android app (used by emulator path)
async function installAndLaunchAndroid(device: Device, apkPath: string) {
  console.log('   Installing APK...')
  const installResult = await installAndroidApp(device, apkPath)
  if (!installResult.success) {
    console.error(`   Install failed: ${installResult.message}`)
    process.exit(1)
  }

  console.log('   Launching app...')
  const launchResult = await launchAndroidApp(device, 'sia.storage.dev')
  if (!launchResult.success) {
    console.error(`   Launch failed: ${launchResult.message}`)
    process.exit(1)
  }

  console.log('✅ App launched on emulator')
}

// === Run Android on Physical Device ===
async function runAndroidDevice(): Promise<void> {
  console.log('🤖 Running on Android device...')

  const apkPath = await findAndroidApk()

  // Look only for physical devices (not emulators)
  console.log('   Looking for connected device...')
  let devices = await listDevices('android')
  let device = selectAndroidDevice(devices)

  // If no device found, restart adb and try again (helps with flaky USB connections)
  if (!device) {
    console.log('   No device detected, restarting adb server...')
    await $`adb kill-server`.quiet().nothrow()
    await $`adb start-server`.quiet().nothrow()
    await new Promise((r) => setTimeout(r, 2000))
    devices = await listDevices('android')
    device = selectAndroidDevice(devices)
  }

  if (!device) {
    console.error('')
    console.error('   No Android device connected.')
    console.error('')
    console.error('   Connect a device via USB and enable USB debugging.')
    console.error('   Run `adb devices` to verify.')
    process.exit(1)
  }

  console.log(`   Found: ${device.name} (${device.id})`)

  // Install with retry for flaky USB connections
  console.log('   Installing APK... (keep device connected)')
  for (let attempt = 1; attempt <= 3; attempt++) {
    const installResult = await installAndroidApp(device, apkPath)

    if (installResult.success) {
      break
    }

    if (installResult.error === 'not_found' && attempt < 3) {
      console.log(`   Device disconnected, reconnecting... (attempt ${attempt + 1}/3)`)
      await $`adb kill-server`.quiet().nothrow()
      await $`adb start-server`.quiet().nothrow()
      await new Promise((r) => setTimeout(r, 2000))

      // Refresh device (only physical devices)
      const refreshedDevices = await listDevices('android')
      const refreshedDevice = selectAndroidDevice(refreshedDevices)
      if (refreshedDevice) {
        device = refreshedDevice
        console.log(`   Reconnected: ${device.name} (${device.id})`)
        console.log('   Retrying install...')
        continue
      }
    }

    console.error('')
    console.error(`   Install failed: ${installResult.message}`)
    process.exit(1)
  }

  console.log('   Launching app...')
  const launchResult = await launchAndroidApp(device, 'sia.storage.dev')
  if (!launchResult.success) {
    console.error(`   Launch failed: ${launchResult.message}`)
    process.exit(1)
  }

  console.log('✅ App launched on device')
}

// === Run Android on Emulator ===
async function runAndroidEmulator(): Promise<void> {
  console.log('🤖 Running on Android Emulator...')

  const apkPath = await findAndroidApk()

  // Look only for emulators (not physical devices)
  console.log('   Looking for running emulator...')
  const devices = await listDevices('android')
  let device = selectAndroidEmulator(devices)

  if (!device) {
    console.log('   No emulator running, starting one...')
    const avdsResult = await $`emulator -list-avds`.quiet().nothrow()
    const avds = avdsResult.stdout.toString().trim().split('\n').filter(Boolean)
    if (avds.length === 0) {
      console.error('')
      console.error('   No Android emulator found.')
      console.error('   Create one in Android Studio > Device Manager.')
      process.exit(1)
    }
    console.log(`   Starting: ${avds[0]}`)
    Bun.spawn(['sh', '-c', `emulator -avd ${avds[0]} &`], {
      stdout: 'ignore',
      stderr: 'ignore',
    })
    console.log('   Waiting for emulator to boot...')
    for (let i = 0; i < 60; i++) {
      const updatedDevices = await listDevices('android')
      const emulator = selectAndroidEmulator(updatedDevices)
      if (emulator) {
        device = emulator
        break
      }
      await new Promise((r) => setTimeout(r, 2000))
    }
  }

  if (!device) {
    console.error('')
    console.error('   Emulator failed to start within 2 minutes.')
    console.error('   Try starting it manually from Android Studio.')
    process.exit(1)
  }

  console.log(`   Found: ${device.name} (${device.id})`)
  await installAndLaunchAndroid(device, apkPath)
}

// Find iOS Simulator app in DerivedData
async function findIosSimApp(): Promise<string | null> {
  const result =
    await $`find ${paths.derivedData} -name "*.app" -path "*Debug-iphonesimulator*" -type d 2>/dev/null`
      .quiet()
      .nothrow()
  const found = result.stdout.toString().trim().split('\n').filter(Boolean)[0]
  return found || null
}
