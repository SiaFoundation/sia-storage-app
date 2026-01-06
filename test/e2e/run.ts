#!/usr/bin/env bun
import { $ } from 'bun'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'

const E2E_DIR = import.meta.dir
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

if (process.env.E2E_CONNECT_KEY) {
  args.push('-e', `E2E_CONNECT_KEY=${process.env.E2E_CONNECT_KEY}`)
}

// Run maestro
const result = await $`maestro ${args}`.env(env).nothrow()
process.exit(result.exitCode)
