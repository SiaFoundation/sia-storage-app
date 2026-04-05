import type { DatabaseAdapter } from '../adapters/db'

export type MigrationProgressEvent = {
  id: string
  message: string
}

export type MigrationProgressHandler = (event: MigrationProgressEvent) => void

export type Migration = {
  id: string
  description: string
  up: (db: DatabaseAdapter, onProgress?: MigrationProgressHandler) => Promise<void>
}
