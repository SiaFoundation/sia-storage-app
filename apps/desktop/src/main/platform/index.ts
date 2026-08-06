/*
 * The only place the app branches on which OS it is running on.
 *
 * Everything downstream takes a PlatformIntegration and never asks what it is,
 * so adding a platform is a new module plus one line here.
 */

import { createDarwinIntegration } from './darwin'
import type { PlatformIntegration } from './types'

export type { PlatformIntegration, ShellConfig, ShellState } from './types'

export function createPlatformIntegration(): PlatformIntegration {
  if (process.platform === 'darwin') return createDarwinIntegration()
  throw new Error(`No storage-provider shell for ${process.platform}`)
}
