import { getPaths } from '@siastorage/node-adapters'
import { ensureDaemonRunning } from '../daemon/supervisor'
import { createDaemonClient } from '../lib/appServiceClient'
import { c } from '../lib/format'

export async function syncCommand(dataDir: string) {
  const p = getPaths(dataDir)
  await ensureDaemonRunning(p)

  const app = createDaemonClient(p.sockPath)
  const conn = await app.connection.getState()
  if (!conn.isConnected) {
    console.log(c.yellow('Not connected to indexer'))
    return
  }

  const sync = await app.sync.getState()

  console.log(c.bold('Sync Status'))
  console.log()
  console.log(`Sync Down: ${sync.isSyncingDown ? c.yellow('syncing') : c.green('idle')}`)
  console.log(`  Processed: ${sync.syncDownCount}`)
  if (sync.syncDownProgress > 0 && sync.syncDownProgress < 1) {
    console.log(`  Progress:  ${(sync.syncDownProgress * 100).toFixed(1)}%`)
  }
  console.log()
  console.log(`Sync Up:   ${sync.isSyncingUp ? c.yellow('syncing') : c.green('idle')}`)
  console.log(`  Progress:  ${sync.syncUpProcessed}/${sync.syncUpTotal}`)
}
