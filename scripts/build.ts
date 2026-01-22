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
import { ProgressIndicator } from './progress'

export interface BuildOptions {
  target: BuildTarget
  /** Always clean and prebuild, even if platform dir exists */
  alwaysClean?: boolean
}

/**
 * Build iOS app for simulator
 */
export async function buildIosSim(options: BuildOptions): Promise<void> {
  const { target, alwaysClean = false } = options
  const paths = getTargetPaths(target)
  const label = 'Building iOS'

  console.log(`   Build log: ${paths.buildLog}`)
  $.cwd(PROJECT_ROOT)
  ensureCacheDir(target)

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
      console.error('❌ Prebuild failed. Last 30 lines:')
      console.error(getBuildLogTail(target, 30))
      throw new Error('iOS prebuild failed')
    }
  }

  // Build for simulator
  const progress = new ProgressIndicator()
  progress.start(label)

  const proc = Bun.spawn(['xcodebuild',
    '-workspace', 'ios/SiaStorageDev.xcworkspace',
    '-scheme', 'SiaStorageDev',
    '-configuration', 'Debug',
    '-sdk', 'iphonesimulator',
    '-arch', 'arm64',
    '-derivedDataPath', paths.derivedData,
    'build',
    'CODE_SIGN_IDENTITY=-',
    'CODE_SIGNING_ALLOWED=YES'
  ], {
    cwd: PROJECT_ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
  })

  let output = ''
  const reader = proc.stdout.getReader()
  const decoder = new TextDecoder()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value)
    output += chunk
    progress.updatePhase(chunk)
  }

  const exitCode = await proc.exited
  writeBuildLog(target, `=== XCODEBUILD ===\n${output}`, true)

  if (exitCode !== 0 || output.includes('BUILD FAILED')) {
    progress.stop(false)
    console.error('❌ Build failed. Last 50 lines:')
    console.error(getBuildLogTail(target, 50))
    throw new Error('iOS build failed - see ' + paths.buildLog)
  }

  progress.stop(true)
  saveBuildHash(target)
}

/**
 * Build iOS app for device via fastlane
 */
export async function buildIosDevice(options: BuildOptions): Promise<void> {
  const { target } = options
  const paths = getTargetPaths(target)
  const label = 'Building iOS (device)'

  console.log(`   Build log: ${paths.buildLog}`)
  ensureCacheDir(target)

  const progress = new ProgressIndicator()
  progress.start(label)

  const buildResult = await $`fastlane ios dev_device 2>&1`.quiet().nothrow()
  const output = buildResult.stdout.toString()
  writeBuildLog(target, `=== FASTLANE ===\n${output}`, true)
  progress.updatePhase(output)

  if (buildResult.exitCode !== 0) {
    progress.stop(false)
    console.error('❌ Build failed. Last 50 lines:')
    console.error(getBuildLogTail(target, 50))
    throw new Error('iOS device build failed')
  }

  progress.stop(true)
  saveBuildHash(target)
}

/**
 * Build Android app
 */
export async function buildAndroid(options: BuildOptions): Promise<void> {
  const { target, alwaysClean = false } = options
  const paths = getTargetPaths(target)
  const label = 'Building Android'

  console.log(`   Build log: ${paths.buildLog}`)
  $.cwd(PROJECT_ROOT)
  ensureCacheDir(target)

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
      console.error('❌ Prebuild failed. Last 30 lines:')
      console.error(getBuildLogTail(target, 30))
      throw new Error('Android prebuild failed')
    }
  }

  // Build APK
  const progress = new ProgressIndicator()
  progress.start(label)

  const proc = Bun.spawn(['./gradlew', 'assembleDebug', '--no-daemon'], {
    cwd: join(PROJECT_ROOT, 'android'),
    stdout: 'pipe',
    stderr: 'pipe',
  })

  let output = ''
  const reader = proc.stdout.getReader()
  const decoder = new TextDecoder()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value)
    output += chunk
    progress.updatePhase(chunk)
  }

  const exitCode = await proc.exited
  writeBuildLog(target, `=== GRADLE ===\n${output}`, true)

  if (exitCode !== 0 || output.includes('BUILD FAILED')) {
    progress.stop(false)
    console.error('❌ Build failed. Last 50 lines:')
    console.error(getBuildLogTail(target, 50))
    throw new Error('Android build failed - see ' + paths.buildLog)
  }

  progress.stop(true)
  saveBuildHash(target)
}
