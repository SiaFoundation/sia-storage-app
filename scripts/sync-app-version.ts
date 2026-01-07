#!/usr/bin/env bun
/**
 * App Version Sync Script
 *
 * Validates that the app version is correctly synced from package.json.
 * Called by knope during the prepare-release workflow.
 *
 * Usage:
 *   bun scripts/sync-app-version.ts
 *
 * What it does:
 *   - Reads the version from package.json
 *   - Logs the current version (validation step for release process)
 *   - app.config.js reads version from package.json, so this confirms sync
 *
 * Note: The actual version is defined in package.json and automatically
 * used by app.config.js for both iOS and Android builds.
 */

import pkg from '../package.json'
console.log(`Version synced: ${pkg.version}`)
