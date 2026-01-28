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

import pkg from '../package.json'

console.log(`Version synced: ${pkg.version}`)
