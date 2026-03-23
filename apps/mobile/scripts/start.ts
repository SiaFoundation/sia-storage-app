#!/usr/bin/env bun
/**
 * Start the Expo dev server, killing any existing Metro process first.
 * If stale processes were found, automatically adds --reset-cache to
 * clear ghost connections that cause the "multiple hosts" DevTools error.
 *
 * Uses stdio: 'inherit' so the interactive Expo menu works properly.
 */

import { $ } from 'bun'

// Kill any existing process on port 8081 (Metro bundler)
const killResult = await $`lsof -ti:8081`.quiet().nothrow()
const pids = killResult.stdout.toString().trim()

let resetCache = false
if (pids) {
  await $`kill -9 ${pids}`.quiet().nothrow()
  resetCache = true
  console.log('Killed existing Metro process, starting with --reset-cache')
}

const extraArgs = process.argv.slice(2)
const args = ['bunx', 'expo', 'start', '--dev-client', ...extraArgs]
if (resetCache && !extraArgs.includes('--reset-cache')) {
  args.push('--reset-cache')
}

// Start Expo dev server with inherited stdio for interactive menu
const proc = Bun.spawn(args, {
  cwd: `${import.meta.dir}/..`,
  stdio: ['inherit', 'inherit', 'inherit'],
  env: process.env,
})

// Wait for the process to exit
await proc.exited
