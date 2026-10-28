import { getPaths } from '@siastorage/node-adapters'
import { ensureDaemonRunning } from '../daemon/supervisor'
import { createDaemonClient } from '../lib/appServiceClient'
import {
  CACHE_AGE_FORMS,
  CACHE_SIZE_FORMS,
  formatCacheAge,
  formatCacheSize,
  parseCacheAge,
  parseCacheSize,
} from '../lib/cacheConfig'
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
      case 'cacheMaxBytes': {
        const bytes = parseCacheSize(value)
        if (bytes === undefined) {
          console.error(`Not a cache size: ${value}. Use ${CACHE_SIZE_FORMS}.`)
          process.exit(1)
        }
        await app.settings.setCacheMaxBytes(bytes)
        console.log(`Set ${c.bold(key)} = ${formatCacheSize(bytes)}`)
        break
      }
      case 'cacheMinAge': {
        const ms = parseCacheAge(value)
        if (ms === undefined) {
          console.error(`Not a duration: ${value}. Use ${CACHE_AGE_FORMS}.`)
          process.exit(1)
        }
        await app.settings.setCacheMinAge(ms)
        console.log(`Set ${c.bold(key)} = ${formatCacheAge(ms)}`)
        break
      }
      default:
        console.error(`Unknown config key: ${key}`)
        console.error('Available keys: indexerUrl, cacheMaxBytes, cacheMinAge')
        process.exit(1)
    }
    return
  }

  const indexerUrl = await app.settings.getIndexerURL()
  const hasOnboarded = await app.settings.getHasOnboarded()
  const cacheMaxBytes = await app.settings.getCacheMaxBytes()
  const cacheMinAge = await app.settings.getCacheMinAge()

  console.log(c.bold('Configuration'))
  console.log(`  Indexer URL:    ${indexerUrl}`)
  console.log(`  Onboarded:      ${hasOnboarded ? c.green('yes') : c.dim('no')}`)
  console.log(`  Cache limit:    ${formatCacheSize(cacheMaxBytes)}`)
  console.log(`  Cache min age:  ${formatCacheAge(cacheMinAge)}`)
}
