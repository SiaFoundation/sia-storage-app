import { join } from 'node:path'
import { loadServeConfig, saveServeConfig, type RouteConfig } from '../serve/access'
import { c } from '../lib/format'

function getConfigPath(dataDir: string): string {
  return join(dataDir, 'serve.json')
}

export async function listRoutesCommand(dataDir: string) {
  const config = loadServeConfig(getConfigPath(dataDir))

  if (config.routes.length === 0) {
    console.log(c.dim('No routes configured.'))
    console.log(c.dim('Add routes with: sia serve routes add <path> --listing'))
    return
  }

  for (const route of config.routes) {
    const pathLabel = route.path || '(root)'
    const flags: string[] = []
    if (Array.isArray(route.listing)) {
      flags.push(c.green(`listed [${route.listing.join(', ')}]`))
    } else {
      flags.push(route.listing ? c.green('listed') : c.dim('unlisted'))
    }
    flags.push(route.download ? c.green('download') : c.dim('no-download'))
    if (route.recursive) flags.push(c.cyan('recursive'))
    console.log(`${pathLabel.padEnd(30)}${flags.join('  ')}`)
  }
}

export async function addRouteCommand(
  dataDir: string,
  routePath: string,
  opts: { listing?: boolean; download?: boolean; recursive?: boolean },
) {
  const configPath = getConfigPath(dataDir)
  const config = loadServeConfig(configPath)

  const normalized = routePath.replace(/^\/+/, '').replace(/\/+$/, '')

  const existing = config.routes.find((r) => r.path === normalized)
  if (existing) {
    if (opts.listing !== undefined) existing.listing = opts.listing
    if (opts.download !== undefined) existing.download = opts.download
    if (opts.recursive !== undefined) existing.recursive = opts.recursive
    saveServeConfig(configPath, config)
    console.log(`Updated route: ${normalized || '(root)'}`)
    printRoute(existing)
    return
  }

  const route: RouteConfig = {
    path: normalized,
    listing: opts.listing ?? false,
    download: opts.download ?? true,
    recursive: opts.recursive ?? false,
  }

  config.routes.push(route)
  saveServeConfig(configPath, config)
  console.log(`Added route: ${normalized || '(root)'}`)
  printRoute(route)
}

export async function removeRouteCommand(dataDir: string, routePath: string) {
  const configPath = getConfigPath(dataDir)
  const config = loadServeConfig(configPath)

  const normalized = routePath.replace(/^\/+/, '').replace(/\/+$/, '')
  const idx = config.routes.findIndex((r) => r.path === normalized)

  if (idx === -1) {
    console.error(`Route not found: ${normalized || '(root)'}`)
    process.exit(1)
  }

  config.routes.splice(idx, 1)
  saveServeConfig(configPath, config)
  console.log(`Removed route: ${normalized || '(root)'}`)
}

function printRoute(route: RouteConfig) {
  const listingStr = Array.isArray(route.listing)
    ? `[${route.listing.join(', ')}]`
    : route.listing
      ? 'yes'
      : 'no'
  console.log(`  listing: ${listingStr}`)
  console.log(`  download: ${route.download ? 'yes' : 'no'}`)
  console.log(`  recursive: ${route.recursive ? 'yes' : 'no'}`)
}
