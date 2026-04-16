import { uint8ToHex } from '@siastorage/core'
import type { DatabaseAdapter, SdkAdapter, SdkAuthAdapters } from '@siastorage/core/adapters'
// oxlint-disable-next-line no-restricted-imports -- CLI daemon needs internal API to set SDK
import type { AppService, AppServiceInternal } from '@siastorage/core/app'
import { createAppService } from '@siastorage/core/app'
import { APP_META } from '@siastorage/core/config'
import { runMigrations } from '@siastorage/core/db'
import { coreMigrations, sortMigrations } from '@siastorage/core/db/migrations'
import type { FsIOAdapter } from '@siastorage/core/services/fsFileUri'
import type { UploadManager } from '@siastorage/core/services/uploader'
import {
  createJsonFileStorage,
  createNodeCryptoAdapter,
  createNodeDetectMimeType,
  createNodeDownloadAdapter,
  createNodeFsIO,
  createNodeSdkAdapter,
  createNodeSdkAuthAdapter,
  createNodeUploaderAdapters,
  createSharpThumbnailAdapter,
  ensureDataDir,
  getDataDir,
  getPaths,
  type NodeSdkAuthResult,
} from '@siastorage/node-adapters'
import { createBunDatabase } from '@siastorage/node-adapters/bunDatabase'

export const isTestMode = process.env.SIA_TEST_MODE === '1'

export type CliApp = {
  service: AppService
  internal: AppServiceInternal
  uploadManager: UploadManager
  db: DatabaseAdapter
  fsIO: FsIOAdapter
  paths: ReturnType<typeof getPaths>
  bootstrap: Bootstrap
}

export type CreateDatabaseFn = (path: string) => DatabaseAdapter

/**
 * Bundle of auth + SDK adapters chosen at startup. Holds the strategy for
 * connecting the SDK so callers don't need to know whether they're running
 * against a real indexer or a MockSdk.
 */
export type Bootstrap = {
  authAdapters: SdkAuthAdapters
  sdkAuth: NodeSdkAuthResult
  /** Set only when running with `SIA_TEST_MODE=1` — pre-attached during bootstrap. */
  testSdkAdapter?: SdkAdapter
  /** Performs the SDK connection (real handshake or test-mode short-circuit). */
  connect: (app: CliApp) => Promise<boolean>
}

async function buildBootstrap(): Promise<Bootstrap> {
  if (isTestMode) {
    const { createTestBootstrap } = await import('./testMode')
    return createTestBootstrap()
  }
  return createRealBootstrap()
}

function createRealBootstrap(): Bootstrap {
  const sdkAuth = createNodeSdkAuthAdapter()
  return {
    authAdapters: sdkAuth.adapters,
    sdkAuth,
    async connect(app) {
      const indexerURL = await app.service.settings.getIndexerURL()
      const keyBytes = await app.service.auth.getAppKey(indexerURL)
      if (!keyBytes) return false

      const keyHex = uint8ToHex(new Uint8Array(keyBytes))
      await sdkAuth.adapters.createBuilder(indexerURL, JSON.stringify(APP_META))

      const connected = await sdkAuth.adapters.connectWithKey(keyHex)
      if (!connected) return false

      const sdk = sdkAuth.getLastSdk()
      if (!sdk) return false

      app.internal.setSdk(createNodeSdkAdapter(sdk))
      app.service.connection.setState({ isConnected: true })
      app.internal.initUploader()
      return true
    },
  }
}

export async function createCliAppService(
  dataDir?: string,
  opts?: { createDatabase?: CreateDatabaseFn },
): Promise<CliApp> {
  const dir = dataDir ?? getDataDir()
  const p = getPaths(dir)
  ensureDataDir(dir)

  const createDb = opts?.createDatabase ?? createBunDatabase
  const db = createDb(p.dbPath)
  await runMigrations(db, sortMigrations(coreMigrations))

  const storage = createJsonFileStorage(p.storagePath)
  const secrets = createJsonFileStorage(p.secretsPath, { mode: 0o600 })
  const crypto = createNodeCryptoAdapter()
  const fsIO = createNodeFsIO(p.filesDir)
  const uploaderAdapters = createNodeUploaderAdapters()
  const detectMimeType = createNodeDetectMimeType()
  const thumbnail = createSharpThumbnailAdapter()

  const bootstrap = await buildBootstrap()

  const { service, internal, uploadManager } = createAppService({
    db,
    storage,
    secrets,
    crypto,
    fsIO,
    downloadObject: createNodeDownloadAdapter({
      fsIO,
      getAppKey: async (indexerURL: string) => service.auth.getAppKey(indexerURL),
    }),
    uploader: uploaderAdapters,
    sdkAuth: bootstrap.authAdapters,
    thumbnail,
    detectMimeType,
  })

  // In test mode the MockSdk attaches before connectSdk runs, so the daemon
  // comes up with an SDK already wired and connectSdk just flips the flag.
  if (bootstrap.testSdkAdapter) {
    internal.setSdk(bootstrap.testSdkAdapter)
  }

  return { service, internal, uploadManager, db, fsIO, paths: p, bootstrap }
}

/** Performs the SDK connection chosen at bootstrap (real or test-mode). */
export function connectSdk(app: CliApp): Promise<boolean> {
  return app.bootstrap.connect(app)
}
