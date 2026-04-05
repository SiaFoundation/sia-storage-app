/**
 * Build Cache Utilities
 *
 * Shared module for smart build caching across dev and E2E scripts.
 *
 * How it works:
 * - Computes a hash from files that affect native builds (package.json, plugins, etc.)
 * - Each build target (ios-sim, ios-device, android, e2e-ios, e2e-android) has its own cache
 * - Skips rebuild if hash matches and artifacts exist
 * - Cache stored in .build-cache/ directory (survives rimraf ios/android)
 */

import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Glob } from 'bun'

// Project paths
export const PROJECT_ROOT = join(import.meta.dir, '..')
export const BUILD_CACHE_DIR = join(PROJECT_ROOT, '.build-cache')

// Build targets - each has isolated cache
// Note: E2E uses the same targets as dev since builds are identical
// Note: Android emulator and device share the same build (same APK works for both)
export type BuildTarget =
  | 'ios-sim' // iOS Simulator builds (dev and e2e)
  | 'ios-device' // iOS real device builds (debug)
  | 'ios-device-release' // iOS real device builds (release, standalone)
  | 'android' // Android builds (emulator and device share same APK, debug)
  | 'android-release' // Android release builds (standalone)

// Get paths for a specific build target
export function getTargetPaths(target: BuildTarget) {
  const targetDir = join(BUILD_CACHE_DIR, target)
  return {
    dir: targetDir,
    hashFile: join(targetDir, 'build-hash'),
    derivedData: join(targetDir, 'DerivedData'),
    buildLog: join(targetDir, 'build.log'),
  }
}

/**
 * Compute hash from all files that affect native builds.
 * Same files used for both dev and E2E to ensure consistency.
 */
export function computeBuildHash(): string {
  // Core config files that affect native builds
  const coreFiles = ['package.json', 'bun.lock', 'app.config.js', 'eas.json']

  // Find all plugin files (custom native code)
  const pluginGlob = new Glob('plugins/*.js')
  const pluginFiles = Array.from(pluginGlob.scanSync({ cwd: PROJECT_ROOT })).sort()

  const allFiles = [...coreFiles, ...pluginFiles]
  const content = allFiles
    .map((f) => {
      const path = join(PROJECT_ROOT, f)
      return existsSync(path) ? readFileSync(path, 'utf-8') : ''
    })
    .join('')

  return createHash('md5').update(content).digest('hex').slice(0, 12)
}

/**
 * Check if a rebuild is needed for the given target.
 * Returns [needed, reason] tuple.
 */
export function needsRebuild(
  target: BuildTarget,
  options: { forceRebuild?: boolean } = {},
): [boolean, string] {
  if (options.forceRebuild) {
    return [true, '--rebuild flag specified']
  }

  const paths = getTargetPaths(target)
  const currentHash = computeBuildHash()

  // Check if cache directory exists
  if (!existsSync(paths.dir)) {
    return [true, 'no build cache found']
  }

  // Check if hash file exists
  if (!existsSync(paths.hashFile)) {
    return [true, 'build hash not found']
  }

  // Check if hash matches
  const savedHash = readFileSync(paths.hashFile, 'utf-8').trim()
  if (savedHash !== currentHash) {
    return [true, `hash changed (${savedHash} -> ${currentHash})`]
  }

  // Check if build artifacts exist
  const platform = target.includes('ios') ? 'ios' : 'android'

  if (platform === 'ios') {
    // Check for DerivedData with built app
    if (!existsSync(paths.derivedData)) {
      return [true, 'DerivedData not found']
    }
  } else {
    // Android: check for APK in standard location
    const apkVariant = target === 'android-release' ? 'release' : 'debug'
    const apkDir = join(PROJECT_ROOT, `android/app/build/outputs/apk/${apkVariant}`)
    if (!existsSync(apkDir)) {
      return [true, 'no Android APK found']
    }
  }

  // Check platform source directory exists (needed for build)
  const platformDir = join(PROJECT_ROOT, platform)
  if (!existsSync(platformDir)) {
    return [true, `${platform}/ directory not found (run prebuild)`]
  }

  return [false, `hash matches (${currentHash})`]
}

/**
 * Save build hash after successful build.
 */
export function saveBuildHash(target: BuildTarget): void {
  const paths = getTargetPaths(target)
  mkdirSync(paths.dir, { recursive: true })
  writeFileSync(paths.hashFile, computeBuildHash())
}

/**
 * Ensure the build cache directory exists.
 */
export function ensureCacheDir(target: BuildTarget): void {
  const paths = getTargetPaths(target)
  mkdirSync(paths.dir, { recursive: true })
}

/**
 * Write to build log file (instead of flooding stdout).
 */
export function writeBuildLog(target: BuildTarget, content: string, append = false): void {
  const paths = getTargetPaths(target)
  mkdirSync(paths.dir, { recursive: true })
  if (append && existsSync(paths.buildLog)) {
    appendFileSync(paths.buildLog, content)
  } else {
    writeFileSync(paths.buildLog, content)
  }
}

/**
 * Append to build log file (efficient streaming).
 */
export function appendBuildLog(target: BuildTarget, content: string): void {
  const paths = getTargetPaths(target)
  appendFileSync(paths.buildLog, content)
}

/**
 * Get the last N lines from build log (for error display).
 */
export function getBuildLogTail(target: BuildTarget, lines = 50): string {
  const paths = getTargetPaths(target)
  if (!existsSync(paths.buildLog)) return ''
  const content = readFileSync(paths.buildLog, 'utf-8')
  return content.split('\n').slice(-lines).join('\n')
}

/**
 * Save build duration after a successful build.
 */
export function saveBuildDuration(target: BuildTarget, durationMs: number): void {
  const paths = getTargetPaths(target)
  const durationFile = join(paths.dir, 'build-duration')
  mkdirSync(paths.dir, { recursive: true })
  writeFileSync(durationFile, String(durationMs))
}

/**
 * Load previous build duration for time estimates.
 * Returns null if no previous duration exists.
 */
export function loadBuildDuration(target: BuildTarget): number | null {
  const paths = getTargetPaths(target)
  const durationFile = join(paths.dir, 'build-duration')
  if (!existsSync(durationFile)) return null
  const content = readFileSync(durationFile, 'utf-8').trim()
  const duration = parseInt(content, 10)
  return Number.isNaN(duration) ? null : duration
}
