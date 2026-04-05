/** Lifecycle stage of the sync gate overlay shown during initial catch-up. */
export type SyncGateStatus = 'idle' | 'pending' | 'active' | 'dismissed'

/** Current state of the bi-directional sync engine. */
export type SyncState = {
  /** Whether this device is the active sync leader. */
  isLeader: boolean
  isSyncingDown: boolean
  /** Total number of objects processed during sync-down. */
  syncDownCount: number
  /** Estimated sync-down progress from 0 to 1, based on event timestamps. */
  syncDownProgress: number
  isSyncingUp: boolean
  syncUpProcessed: number
  syncUpTotal: number
  /** Gate overlay status for initial sync catch-up. Session-scoped. */
  syncGateStatus: SyncGateStatus
}

/** Lifecycle stage of a single upload. */
export type UploadStatus = 'queued' | 'packing' | 'packed' | 'uploading' | 'done' | 'error'

/** Tracks the state of a single upload. */
export type UploadEntry = {
  id: string
  name?: string
  /** File size in bytes. */
  size: number
  /** Upload progress from 0 to 1. */
  progress: number
  status: UploadStatus
  error?: string
  /** Groups related uploads into a single batch. */
  batchId?: string
  /** Total number of files in this entry's batch. */
  batchFileCount?: number
}

/** Aggregate state of all active and recent uploads. */
export type UploadsState = {
  uploads: Record<string, UploadEntry>
}

/** Lifecycle stage of a single download. */
export type DownloadStatus = 'queued' | 'downloading' | 'done' | 'error'

/** Tracks the state of a single download. */
export type DownloadEntry = {
  id: string
  status: DownloadStatus
  /** Download progress from 0 to 1. */
  progress: number
  error?: string
}

/** Aggregate state of all active and recent downloads. */
export type DownloadsState = {
  downloads: Record<string, DownloadEntry>
}

/** State of the connection to the Sia network. */
export type ConnectionState = {
  isConnected: boolean
  connectionError: string | null
  /** Whether an authentication handshake is in progress. */
  isAuthing: boolean
  isReconnecting: boolean
}

/** A single step in the app initialization sequence. */
export type InitStep = {
  id: string
  /** Human-readable name shown in the UI. */
  label: string
  /** Detailed status or error message for this step. */
  message: string
  /** Epoch timestamp (ms) when this step began. */
  startedAt: number
}

/** Overall app initialization progress and status. */
export type InitState = {
  steps: Record<string, InitStep>
  isInitializing: boolean
  initializationError: string | null
}
