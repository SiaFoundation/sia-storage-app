import type { Platform } from './devices'

/**
 * Prompts the user to confirm a full rebuild. Exits if they decline.
 */
export function confirmRebuild(platform: Platform): void {
  const answer = prompt(
    `⚠️  Full rebuild will delete ${platform}/ and rebuild from scratch. Continue? [y/N]`,
  )
  const normalized = answer?.trim().toLowerCase() ?? ''
  if (normalized !== 'y' && normalized !== 'yes') {
    console.log('Aborted.')
    process.exit(0)
  }
}
