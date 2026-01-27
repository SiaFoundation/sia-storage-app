/**
 * Shared Build Functions
 *
 * Common build logic for dev.ts and e2e.ts scripts.
 */

import { $ } from 'bun'
import { existsSync } from 'fs'
import { join } from 'path'
import {
  PROJECT_ROOT,
  type BuildTarget,
  getTargetPaths,
  saveBuildHash,
  ensureCacheDir,
  writeBuildLog,
  getBuildLogTail,
} from './buildCache'
import { runProcess } from './lib/process'

export interface BuildOptions {
  target: BuildTarget
  /** Always clean and prebuild, even if platform dir exists */
  alwaysClean?: boolean
}

/**
 * Kill any existing build processes to prevent zombies.
 */
async function killExistingBuilds(platform: 'ios' | 'android'): Promise<void> {
  if (platform === 'ios') {
    // Kill xcodebuild processes for this project
    await $`pkill -f "xcodebuild.*SiaStorageDev" 2>/dev/null`.quiet().nothrow()
  } else {
    // Kill gradle processes for this project
    await $`pkill -f "gradlew.*assembleDebug" 2>/dev/null`.quiet().nothrow()
  }
}

/**
 * Build iOS app for simulator
 */
export async function buildIosSim(options: BuildOptions): Promise<void> {
  const { target, alwaysClean = false } = options
  const paths = getTargetPaths(target)

  console.log(`   Build log: ${paths.buildLog}`)
  $.cwd(PROJECT_ROOT)
  ensureCacheDir(target)
  await killExistingBuilds('ios')

  const iosDir = join(PROJECT_ROOT, 'ios')

  // Clean and prebuild if explicitly requested or dir doesn't exist
  if (alwaysClean || !existsSync(iosDir)) {
    if (existsSync(iosDir)) {
      console.log('   Cleaning ios/...')
      await $`rm -rf ${iosDir}`.quiet().nothrow()
    }

    console.log('   Prebuilding...')
    const prebuildResult =
      await $`bunx expo prebuild --platform ios 2>&1`.quiet().nothrow()
    writeBuildLog(target, `=== PREBUILD ===\n${prebuildResult.stdout}\n`)

    if (prebuildResult.exitCode !== 0) {
      console.error('   Prebuild failed. Last 30 lines:')
      console.error(getBuildLogTail(target, 30))
      throw new Error('iOS prebuild failed')
    }
  }

  // Build for simulator using unified process runner
  writeBuildLog(target, '=== XCODEBUILD ===\n', true)

  const result = await runProcess({
    command: [
      'xcodebuild',
      '-workspace',
      'ios/SiaStorageDev.xcworkspace',
      '-scheme',
      'SiaStorageDev',
      '-configuration',
      'Debug',
      '-sdk',
      'iphonesimulator',
      '-arch',
      'arm64',
      '-derivedDataPath',
      paths.derivedData,
      'build',
      'CODE_SIGN_IDENTITY=-',
      'CODE_SIGNING_ALLOWED=YES',
    ],
    cwd: PROJECT_ROOT,
    target,
    label: 'Building iOS',
  })

  if (!result.success) {
    console.error('   Build failed. Last 50 lines:')
    console.error(getBuildLogTail(target, 50))
    throw new Error('iOS build failed - see ' + paths.buildLog)
  }

  saveBuildHash(target)
}

/**
 * Build iOS app for device using xcodebuild directly.
 * Note: Installation is handled separately in dev.ts using devicectl.
 */
export async function buildIosDevice(options: BuildOptions): Promise<void> {
  const { target, alwaysClean = false } = options
  const paths = getTargetPaths(target)

  console.log(`   Build log: ${paths.buildLog}`)
  $.cwd(PROJECT_ROOT)
  ensureCacheDir(target)
  await killExistingBuilds('ios')

  const iosDir = join(PROJECT_ROOT, 'ios')

  // Clean and prebuild if explicitly requested or dir doesn't exist
  if (alwaysClean || !existsSync(iosDir)) {
    if (existsSync(iosDir)) {
      console.log('   Cleaning ios/...')
      await $`rm -rf ${iosDir}`.quiet().nothrow()
    }

    console.log('   Prebuilding...')
    const prebuildResult =
      await $`bunx expo prebuild --platform ios 2>&1`.quiet().nothrow()
    writeBuildLog(target, `=== PREBUILD ===\n${prebuildResult.stdout}\n`)

    if (prebuildResult.exitCode !== 0) {
      console.error('   Prebuild failed. Last 30 lines:')
      console.error(getBuildLogTail(target, 30))
      throw new Error('iOS prebuild failed')
    }
  }

  // Get the team ID from environment
  const teamId = process.env.APPLE_TEAM_ID
  if (!teamId) {
    throw new Error('APPLE_TEAM_ID environment variable is required for device builds')
  }

  // Build for device using xcodebuild directly (no fastlane)
  writeBuildLog(target, '=== XCODEBUILD (device) ===\n', true)

  const result = await runProcess({
    command: [
      'xcodebuild',
      '-workspace',
      'ios/SiaStorageDev.xcworkspace',
      '-scheme',
      'SiaStorageDev',
      '-configuration',
      'Debug',
      '-sdk',
      'iphoneos',
      '-arch',
      'arm64',
      '-derivedDataPath',
      paths.derivedData,
      'build',
      `DEVELOPMENT_TEAM=${teamId}`,
      'CODE_SIGN_STYLE=Automatic',
    ],
    cwd: PROJECT_ROOT,
    target,
    label: 'Building iOS (device)',
  })

  if (!result.success) {
    console.error('   Build failed. Last 50 lines:')
    console.error(getBuildLogTail(target, 50))
    throw new Error('iOS device build failed - see ' + paths.buildLog)
  }

  saveBuildHash(target)
}

/**
 * Build Android app
 */
export async function buildAndroid(options: BuildOptions): Promise<void> {
  const { target, alwaysClean = false } = options
  const paths = getTargetPaths(target)

  console.log(`   Build log: ${paths.buildLog}`)
  $.cwd(PROJECT_ROOT)
  ensureCacheDir(target)
  await killExistingBuilds('android')

  const androidDir = join(PROJECT_ROOT, 'android')

  // Clean and prebuild if explicitly requested or dir doesn't exist
  if (alwaysClean || !existsSync(androidDir)) {
    if (existsSync(androidDir)) {
      console.log('   Cleaning android/...')
      await $`rm -rf ${androidDir}`.quiet().nothrow()
    }

    console.log('   Prebuilding...')
    const prebuildResult =
      await $`bunx expo prebuild --platform android 2>&1`.quiet().nothrow()
    writeBuildLog(target, `=== PREBUILD ===\n${prebuildResult.stdout}\n`)

    if (prebuildResult.exitCode !== 0) {
      console.error('   Prebuild failed. Last 30 lines:')
      console.error(getBuildLogTail(target, 30))
      throw new Error('Android prebuild failed')
    }
  }

  // Build APK using unified process runner
  writeBuildLog(target, '=== GRADLE ===\n', true)

  const result = await runProcess({
    command: ['./gradlew', 'assembleDebug', '--no-daemon'],
    cwd: join(PROJECT_ROOT, 'android'),
    target,
    label: 'Building Android',
  })

  if (!result.success) {
    console.error('   Build failed. Last 50 lines:')
    console.error(getBuildLogTail(target, 50))
    throw new Error('Android build failed - see ' + paths.buildLog)
  }

  saveBuildHash(target)
}

/**
 * Find the built iOS app for device in DerivedData.
 */
export async function findIosDeviceApp(target: BuildTarget): Promise<string | null> {
  const paths = getTargetPaths(target)
  const result =
    await $`find ${paths.derivedData} -name "*.app" -path "*Debug-iphoneos*" -type d 2>/dev/null`
      .quiet()
      .nothrow()
  const found = result.stdout.toString().trim().split('\n').filter(Boolean)[0]
  return found || null
}
