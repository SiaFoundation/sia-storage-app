/**
 * Shared Build Functions
 *
 * Common build logic for dev.ts and e2e.ts scripts.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { $ } from 'bun'
import {
  type BuildTarget,
  ensureCacheDir,
  getBuildLogTail,
  getTargetPaths,
  PROJECT_ROOT,
  saveBuildHash,
  writeBuildLog,
} from './buildCache'
import { runProcess } from './lib/process'

export interface BuildOptions {
  target: BuildTarget
  /** Always clean and prebuild, even if platform dir exists */
  alwaysClean?: boolean
  /** Build with Release configuration (bundles JS, no dev server needed) */
  release?: boolean
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
    await $`pkill -f "gradlew.*assemble(Debug|Release)" 2>/dev/null`.quiet().nothrow()
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
    const prebuildResult = await $`bunx expo prebuild --platform ios 2>&1`.quiet().nothrow()
    writeBuildLog(target, `=== PREBUILD ===\n${prebuildResult.stdout}\n`)

    if (prebuildResult.exitCode !== 0) {
      console.error('   Prebuild failed. Last 30 lines:')
      console.error(getBuildLogTail(target, 30))
      throw new Error('iOS prebuild failed')
    }
  } else {
    // ios/ exists - run pod install to ensure native deps are synced
    console.log('   Running pod install...')
    const podResult = await $`cd ${iosDir} && pod install 2>&1`.quiet().nothrow()
    writeBuildLog(target, `=== POD INSTALL ===\n${podResult.stdout}\n`)

    if (podResult.exitCode !== 0) {
      console.error('   Pod install failed. Last 30 lines:')
      console.error(getBuildLogTail(target, 30))
      throw new Error('iOS pod install failed')
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
    throw new Error(`iOS build failed - see ${paths.buildLog}`)
  }

  saveBuildHash(target)
}

/**
 * Build iOS app for device using xcodebuild directly.
 * Note: Installation is handled separately in dev.ts using devicectl.
 */
export async function buildIosDevice(options: BuildOptions): Promise<void> {
  const { target, alwaysClean = false, release = false } = options
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
    const prebuildResult = await $`bunx expo prebuild --platform ios 2>&1`.quiet().nothrow()
    writeBuildLog(target, `=== PREBUILD ===\n${prebuildResult.stdout}\n`)

    if (prebuildResult.exitCode !== 0) {
      console.error('   Prebuild failed. Last 30 lines:')
      console.error(getBuildLogTail(target, 30))
      throw new Error('iOS prebuild failed')
    }
  } else {
    // ios/ exists - run pod install to ensure native deps are synced
    console.log('   Running pod install...')
    const podResult = await $`cd ${iosDir} && pod install 2>&1`.quiet().nothrow()
    writeBuildLog(target, `=== POD INSTALL ===\n${podResult.stdout}\n`)

    if (podResult.exitCode !== 0) {
      console.error('   Pod install failed. Last 30 lines:')
      console.error(getBuildLogTail(target, 30))
      throw new Error('iOS pod install failed')
    }
  }

  // Get the team ID from environment
  const teamId = process.env.APPLE_TEAM_ID
  if (!teamId) {
    throw new Error('APPLE_TEAM_ID environment variable is required for device builds')
  }

  // Build for device using xcodebuild directly (no fastlane)
  const configuration = release ? 'Release' : 'Debug'
  writeBuildLog(target, `=== XCODEBUILD (device, ${configuration}) ===\n`, true)

  const result = await runProcess({
    command: [
      'xcodebuild',
      '-workspace',
      'ios/SiaStorageDev.xcworkspace',
      '-scheme',
      'SiaStorageDev',
      '-configuration',
      configuration,
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
    label: `Building iOS (device, ${configuration})`,
  })

  if (!result.success) {
    console.error('   Build failed. Last 50 lines:')
    console.error(getBuildLogTail(target, 50))
    throw new Error(`iOS device build failed - see ${paths.buildLog}`)
  }

  saveBuildHash(target)
}

/**
 * Build Android app
 */
export async function buildAndroid(options: BuildOptions): Promise<void> {
  const { target, alwaysClean = false, release = false } = options
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
    const prebuildResult = await $`bunx expo prebuild --platform android 2>&1`.quiet().nothrow()
    writeBuildLog(target, `=== PREBUILD ===\n${prebuildResult.stdout}\n`)

    if (prebuildResult.exitCode !== 0) {
      console.error('   Prebuild failed. Last 30 lines:')
      console.error(getBuildLogTail(target, 30))
      throw new Error('Android prebuild failed')
    }
  }

  // Validate signing env vars for release builds
  if (release) {
    const requiredVars = [
      'SIA_RELEASE_STORE_FILE',
      'SIA_RELEASE_STORE_PASSWORD',
      'SIA_RELEASE_KEY_ALIAS',
      'SIA_RELEASE_KEY_PASSWORD',
    ]
    const missing = requiredVars.filter((v) => !process.env[v])
    if (missing.length > 0) {
      throw new Error(`Android release build requires signing env vars: ${missing.join(', ')}`)
    }
  }

  // Build APK using unified process runner
  const gradleTask = release ? 'assembleRelease' : 'assembleDebug'
  writeBuildLog(target, `=== GRADLE (${gradleTask}) ===\n`, true)

  const result = await runProcess({
    command: ['./gradlew', gradleTask, '--no-daemon'],
    cwd: join(PROJECT_ROOT, 'android'),
    target,
    label: `Building Android (${gradleTask})`,
  })

  if (!result.success) {
    console.error('   Build failed. Last 50 lines:')
    console.error(getBuildLogTail(target, 50))
    throw new Error(`Android build failed - see ${paths.buildLog}`)
  }

  saveBuildHash(target)
}

/**
 * Find the built iOS app for device in DerivedData.
 */
export async function findIosDeviceApp(
  target: BuildTarget,
  options: { release?: boolean } = {},
): Promise<string | null> {
  const paths = getTargetPaths(target)
  const config = options.release ? 'Release' : 'Debug'
  const result =
    await $`find ${paths.derivedData} -name "*.app" -path "*${config}-iphoneos*" -type d 2>/dev/null`
      .quiet()
      .nothrow()
  const found = result.stdout.toString().trim().split('\n').filter(Boolean)[0]
  return found || null
}
