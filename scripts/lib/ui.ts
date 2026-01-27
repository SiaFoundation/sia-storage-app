/**
 * UI Utilities
 *
 * Interactive prompts and user feedback for build scripts.
 */

import * as readline from 'readline'

/**
 * Wait for user to press Enter.
 */
export async function waitForKeypress(message: string): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise((resolve) => {
    rl.question(message, () => {
      rl.close()
      resolve()
    })
  })
}

/**
 * Prompt user to unlock their device and wait for keypress.
 */
export async function waitForDeviceUnlock(deviceName: string): Promise<void> {
  console.log('')
  console.log(`   Device is locked - please unlock ${deviceName}`)
  await waitForKeypress('   Press Enter when unlocked...')
}

/**
 * Print a section header with icon.
 */
export function printHeader(icon: string, title: string): void {
  console.log(`\n${icon} ${title}`)
}

/**
 * Print an indented info line.
 */
export function printInfo(message: string): void {
  console.log(`   ${message}`)
}

/**
 * Print an error message with icon.
 */
export function printError(message: string): void {
  console.error(`   ${message}`)
}

/**
 * Print a success message.
 */
export function printSuccess(message: string): void {
  console.log(`   ${message}`)
}
