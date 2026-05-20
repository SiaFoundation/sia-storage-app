// Foundation
export { createNodeCryptoAdapter } from './crypto'
export { createBetterSqlite3Database } from './database'
export { createBunDatabase } from './bunDatabase'
export { createInMemoryStorage, createJsonFileStorage } from './storage'
export { getDataDir, getPaths, ensureDataDir } from './paths'
export { createNodeFsIO } from './fsIO'
export { createNodeUploaderAdapters } from './uploader'
export { createNodeDetectMimeType } from './detectMimeType'
export { createBunThumbnailAdapter } from './thumbnail'

// Daemon infrastructure
export { acquireLock, isDaemonRunning, readDaemonPid } from './lock'
export type { LockHandle } from './lock'
export { startIpcServer, sendIpcCommand, connectToIpc } from './ipc'
export type { IpcHandler, IpcServer } from './ipc'
export { readState, writeState, removeState } from './state'
export type { DaemonState } from './state'

// SDK integration
export { createNodeSdkAdapter } from './sdk'
export { createNodeSdkAuthAdapter } from './auth'
export type { NodeSdkAuthResult } from './auth'
export { createNodeDownloadAdapter } from './download'

// Logging
export { createNodeFileLogAppender } from './logFileAppender'
