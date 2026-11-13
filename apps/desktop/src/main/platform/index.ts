/*
 * The only place the main process branches on which OS it is running on.
 *
 * What differs by OS is the storage-provider shell behind the file manager
 * folder, the windows' chrome, the words the copy uses, how the logs open,
 * and the settings page for login items. Everything downstream takes what
 * these functions return and never asks which platform it came from, so
 * adding a platform is new modules plus a line in each function here.
 */

import { darwinChrome } from './darwinChrome'
import { createDarwinIntegration } from './darwin'
import { openLogs as openDarwinLogs } from './darwinLogs'
import { standardChrome } from './standardChrome'
import { openLogs as openStandardLogs } from './standardLogs'
import { createUnmountedIntegration } from './unmounted'
import { type PlatformTerms, platformTerms } from '../../shared/platformTerms'
import type { PlatformIntegration, WindowChrome } from './types'

export type { PlatformIntegration, ShellConfig, ShellState, WindowChrome } from './types'

export function createPlatformIntegration(): PlatformIntegration {
  if (process.platform === 'darwin') return createDarwinIntegration()
  return createUnmountedIntegration()
}

/**
 * Where the OS lists the apps that open at login, for the app's switch to
 * send a person to. Null where the app does not offer the switch yet.
 */
export function loginItemSettingsUrl(): string | null {
  return process.platform === 'darwin'
    ? 'x-apple.systempreferences:com.apple.LoginItems-Settings.extension'
    : null
}

export function windowChrome(): WindowChrome {
  return process.platform === 'darwin' ? darwinChrome : standardChrome
}

/**
 * The words the main process's copy uses. The windows build the same terms
 * from the platform name the preload bridge gives them.
 */
export function copyTerms(): PlatformTerms {
  return platformTerms(process.platform)
}

/** Opens the app's logs for a person to read. */
export function openLogs(): Promise<void> {
  return process.platform === 'darwin' ? openDarwinLogs() : openStandardLogs()
}
