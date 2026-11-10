/*
 * Where the main process picks what differs by OS: the storage-provider shell
 * behind the file manager folder, how the logs open, and the settings page
 * for login items. Everything downstream takes what these functions return
 * and never asks which platform it came from, so adding a platform is new
 * modules plus a line in each function here.
 */

import { createDarwinIntegration } from './darwin'
import { openLogs as openDarwinLogs } from './darwinLogs'
import { openLogs as openStandardLogs } from './standardLogs'
import { createUnmountedIntegration } from './unmounted'
import type { PlatformIntegration } from './types'

export type { PlatformIntegration, ShellConfig, ShellState } from './types'

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

/** Opens the app's logs for a person to read. */
export function openLogs(): Promise<void> {
  return process.platform === 'darwin' ? openDarwinLogs() : openStandardLogs()
}
