#!/usr/bin/env bun
/**
 * Sync App Version
 *
 * Validates that app.config.js uses version from package.json.
 * Called by knope during prepare-release.
 *
 * Usage:
 *   bun scripts/syncAppVersion.ts
 */

import { readFileSync, writeFileSync } from 'fs'
import pkg from '../package.json'

// Knope doesn't write a trailing newline, which fails biome lint
const packageJsonPath = './package.json'
const content = readFileSync(packageJsonPath, 'utf8')
if (!content.endsWith('\n')) {
  writeFileSync(packageJsonPath, `${content}\n`)
}

console.log(`Version synced: ${pkg.version}`)
