#!/usr/bin/env bun
/**
 * Start the Expo dev server, killing any existing Metro process first.
 *
 * Uses stdio: 'inherit' so the interactive Expo menu works properly.
 */

import { $ } from 'bun'

// Kill any existing process on port 8081 (Metro bundler)
const killResult = await $`lsof -ti:8081`.quiet().nothrow()
const pids = killResult.stdout.toString().trim()

if (pids) {
  await $`kill -9 ${pids}`.quiet().nothrow()
  console.log('Killed existing Metro process')
}

// Start Expo dev server with inherited stdio for interactive menu
const proc = Bun.spawn(['bunx', 'expo', 'start', '--dev-client'], {
  cwd: import.meta.dir + '/..',
  stdio: ['inherit', 'inherit', 'inherit'],
  env: process.env,
})

// Wait for the process to exit
await proc.exited
