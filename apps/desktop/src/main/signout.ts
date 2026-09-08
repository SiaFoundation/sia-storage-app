/*
 * Signing out, which is a local wipe.
 *
 * The library belongs to the account, so leaving it behind would serve one
 * account's files to the next. Mobile treats sign-out the same way. Everything
 * in the data directory goes except the logs, which are how a sign-out that
 * went wrong is diagnosed; a list of names would go stale on the next file.
 */

import { dialog } from 'electron'
import { readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from './paths'

export async function confirmSignOut(): Promise<boolean> {
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Cancel', 'Sign Out'],
    defaultId: 0,
    cancelId: 0,
    message: 'Sign out and clear local data?',
    detail:
      "This Mac's copy of your library is deleted and you are signed out. Files still uploading will be lost. Signing back in needs your recovery phrase.",
  })
  return response === 1
}

export async function warnWipeBlocked(detail: string): Promise<void> {
  await dialog.showMessageBox({ type: 'error', message: 'Could not sign out', detail })
}

export function wipeLibrary(): void {
  const root = dataDir()
  const entries = readdirSync(root).filter((entry) => !entry.endsWith('.log'))
  // Credentials go last: a wipe that fails partway must not leave a library
  // stripped of its account, or the next sign-in would adopt another
  // account's leftover files as its own.
  entries.sort((a, b) => Number(a === 'secrets.json') - Number(b === 'secrets.json'))
  for (const entry of entries) {
    rmSync(join(root, entry), { recursive: true, force: true })
  }
}
