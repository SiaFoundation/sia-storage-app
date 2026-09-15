/*
 * Finds the Developer ID Application identity in the keychain.
 *
 * A release signs with whichever Developer ID certificate the runner imported,
 * so the SHA-1 is looked up rather than stored, where it would go stale the day
 * the certificate is reissued.
 */

import { $ } from 'bun'

const IDENTITY = /^\s*\d+\)\s+([0-9A-F]{40})\s+"Developer ID Application: [^"]*\((\w+)\)"/gm

/**
 * Parses `security find-identity -v -p codesigning` output. The listing names
 * every identity twice, under "Matching identities" and again under "Valid
 * identities only", so entries are counted by hash.
 */
export function developerIdIdentityFrom(listing: string, teamId?: string): string {
  const matches = new Map<string, string>()
  for (const [, sha, team] of listing.matchAll(IDENTITY)) {
    if (!teamId || team === teamId) matches.set(sha!, team!)
  }
  if (matches.size === 1) return [...matches.keys()][0]!
  const found = [...new Set([...listing.matchAll(/"([^"]+)"/g)].map(([, name]) => name))].join(', ')
  if (matches.size === 0) {
    throw new Error(
      `No Developer ID Application identity${teamId ? ` for team ${teamId}` : ''} in the keychain; found: ${found || 'nothing'}`,
    )
  }
  throw new Error(`More than one Developer ID Application identity in the keychain: ${found}`)
}

export async function developerIdIdentity(teamId?: string): Promise<string> {
  return developerIdIdentityFrom(await $`security find-identity -v -p codesigning`.text(), teamId)
}
