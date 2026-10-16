import { join } from 'node:path'
import { hexToUint8 } from '@siastorage/core'
import { logger } from '@siastorage/logger'
import { startServices } from '../daemon/entry'
import { loadServeConfig } from '../serve/access'
import { startHttpServer } from '../serve/handler'

export async function serveCommand(dataDir: string, opts: { port: string; host: string }) {
  const port = parseInt(opts.port, 10)
  const host = opts.host

  // Bootstrap credentials from env vars if not already onboarded
  // (for containerized deployments like Fly/Cloudflare)
  await bootstrapFromEnv(dataDir)

  // Start the daemon (DB, sync, uploads, IPC) — same as `sia daemon start`
  const ctx = await startServices(dataDir)

  if (!ctx.connected) {
    console.warn('Warning: not connected to indexer. Files not cached locally will be unavailable.')
  }

  const configPath = join(dataDir, 'serve.json')
  const config = loadServeConfig(configPath)

  if (config.routes.length === 0) {
    console.warn(
      'Warning: no routes configured in serve.json. All paths will return 404.\n' +
        'Add routes with: sia serve routes add <path> --listing',
    )
  }

  // Add the HTTP server on top of the daemon
  startHttpServer(ctx.app, { port, host }, config)

  logger.info('serve', 'started', { pid: process.pid, port, connected: ctx.connected })
}

async function bootstrapFromEnv(dataDir: string) {
  const keyHex = process.env.SIA_APP_KEY_HEX
  const indexerUrl = process.env.SIA_INDEXER_URL
  if (!keyHex || !indexerUrl) return

  // Only bootstrap if not already onboarded — avoid overwriting on every restart
  const { createCliAppService } = await import('../app')
  const app = await createCliAppService(dataDir)
  try {
    const hasOnboarded = await app.service.settings.getHasOnboarded()
    if (hasOnboarded) return

    const keyBytes = hexToUint8(keyHex)
    await app.service.auth.setAppKey(indexerUrl, keyBytes)
    await app.service.settings.setIndexerURL(indexerUrl)
    await app.service.settings.setHasOnboarded(true)
    logger.info('serve', 'credentials_bootstrapped', { indexerUrl })
  } finally {
    await app.db.execAsync('PRAGMA wal_checkpoint(TRUNCATE)')
    app.db.close?.()
  }
}
