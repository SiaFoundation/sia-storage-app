import { getPaths } from '@siastorage/node-adapters'
import { ensureDaemonRunning } from '../daemon/supervisor'
import { createDaemonClient } from '../lib/appServiceClient'
import { c } from '../lib/format'

export async function configCommand(
  dataDir: string,
  action?: string,
  key?: string,
  value?: string,
) {
  const p = getPaths(dataDir)
  await ensureDaemonRunning(p)
  const app = createDaemonClient(p.sockPath)

  if (action === 'set' && key && value) {
    switch (key) {
      case 'indexerUrl':
        await app.settings.setIndexerURL(value)
        console.log(`Set ${c.bold(key)} = ${value}`)
        break
      default:
        console.error(`Unknown config key: ${key}`)
        console.error('Available keys: indexerUrl')
        process.exit(1)
    }
    return
  }

  const indexerUrl = await app.settings.getIndexerURL()
  const hasOnboarded = await app.settings.getHasOnboarded()

  console.log(c.bold('Configuration'))
  console.log(`  Indexer URL:  ${indexerUrl}`)
  console.log(`  Onboarded:    ${hasOnboarded ? c.green('yes') : c.dim('no')}`)
}
