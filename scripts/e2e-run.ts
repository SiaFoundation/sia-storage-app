#!/usr/bin/env bun
/**
 * E2E Test Runner for CI
 *
 * Runs Maestro E2E tests in CI environments. This script assumes the app
 * is already built and installed on the device/simulator.
 *
 * Usage:
 *   bun scripts/e2e-run.ts [flow.yml]
 *
 * Arguments:
 *   flow.yml - Optional flow file to run (default: onboarding.yml)
 *
 * Environment:
 *   E2E_CONNECT_KEY - App password for indexer auth (required for auth tests)
 *
 * What it does:
 *   1. Sets RELEASE_BUILD=true (CI uses release builds, no dev client)
 *   2. Runs Maestro with the specified flow
 *   3. Outputs test results to test/e2e/.maestro/tests/
 *
 * Note: For local development with build caching, use e2e-run-local.ts instead.
 */

import { $ } from 'bun'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { PROJECT_ROOT } from './build-cache'

const E2E_DIR = join(PROJECT_ROOT, 'test/e2e')
const FLOWS_DIR = join(E2E_DIR, 'flows')
const OUTPUT_DIR = join(E2E_DIR, '.maestro/tests')

// Ensure output dir exists
if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true })
}

// Get flow file from args or default to onboarding
const flow = process.argv[2] || 'onboarding.yml'
const flowPath = join(FLOWS_DIR, flow)

if (!existsSync(flowPath)) {
  console.error(`Flow not found: ${flowPath}`)
  process.exit(1)
}

// Setup env
const env = {
  ...process.env,
  PATH: `${process.env.PATH}:${process.env.HOME}/.maestro/bin`,
  MAESTRO_DRIVER_STARTUP_TIMEOUT: '300000',
  MAESTRO_CLI_NO_ANALYTICS: '1',
  MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: 'true',
}

// Build maestro args
const args = ['test', flowPath, '--output', OUTPUT_DIR]

// CI runs use release builds (no dev client)
// Pass as -e flag which Maestro uses to set flow env vars
args.push('-e', 'RELEASE_BUILD=true')

if (!process.env.E2E_CONNECT_KEY) {
  console.error('Error: E2E_CONNECT_KEY environment variable is required')
  process.exit(1)
}
args.push('-e', `E2E_CONNECT_KEY=${process.env.E2E_CONNECT_KEY}`)

console.log('Maestro args:', args.join(' '))

// Run maestro
const result = await $`maestro ${args}`.env(env).nothrow()
process.exit(result.exitCode)
