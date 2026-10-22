import { readFileSync, writeFileSync, existsSync } from 'fs'

export type RouteConfig = {
  path: string
  listing: boolean | string[]
  download: boolean
  recursive: boolean
}

export type ServeConfig = {
  routes: RouteConfig[]
}

const defaultConfig: ServeConfig = { routes: [] }

export function loadServeConfig(configPath: string): ServeConfig {
  if (!existsSync(configPath)) return defaultConfig
  const raw = readFileSync(configPath, 'utf-8')
  const parsed = JSON.parse(raw)
  if (!parsed || !Array.isArray(parsed.routes)) return defaultConfig
  return {
    routes: parsed.routes.map((r: Record<string, unknown>) => ({
      path: normalizePath(String(r.path ?? '')),
      listing: Array.isArray(r.listing) ? r.listing.map(String) : r.listing === true,
      download: r.download !== false,
      recursive: r.recursive === true,
    })),
  }
}

export function saveServeConfig(configPath: string, config: ServeConfig): void {
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')
}

function normalizePath(p: string): string {
  return p.replace(/^\/+/, '').replace(/\/+$/, '')
}

/**
 * Find the most specific route matching the given path.
 *
 * Non-recursive routes cover the exact path and one level of children:
 *   route "s" matches "s", "s/file.txt" — but NOT "s/sub/" or "s/sub/file.txt"
 *
 * Recursive routes cover the path and all descendants:
 *   route "public" (recursive) matches "public", "public/a", "public/a/b/c"
 *
 * Most specific (longest path) match always wins.
 */
export function findRoute(path: string, config: ServeConfig): RouteConfig | null {
  const normalized = normalizePath(path)
  let best: RouteConfig | null = null
  let bestLen = -1

  for (const route of config.routes) {
    const rp = route.path

    if (rp === '') {
      if (normalized === '') {
        if (bestLen < 0) {
          best = route
          bestLen = 0
        }
      } else if (route.recursive) {
        if (bestLen < 0) {
          best = route
          bestLen = 0
        }
      } else {
        if (!normalized.includes('/') && bestLen < 0) {
          best = route
          bestLen = 0
        }
      }
      continue
    }

    if (normalized === rp) {
      if (rp.length > bestLen) {
        best = route
        bestLen = rp.length
      }
    } else if (normalized.startsWith(rp + '/')) {
      const remainder = normalized.substring(rp.length + 1)
      if (route.recursive) {
        if (rp.length > bestLen) {
          best = route
          bestLen = rp.length
        }
      } else {
        if (!remainder.includes('/') && rp.length > bestLen) {
          best = route
          bestLen = rp.length
        }
      }
    }
  }

  return best
}

/** Check if a path has any matching route (is served at all). */
export function isPathServed(path: string, config: ServeConfig): boolean {
  return findRoute(path, config) !== null
}

/**
 * Check if directory listing is allowed for this path.
 * - true: all items shown
 * - false: no listing
 * - string[]: only items with matching names shown (use isNameListed to filter)
 */
export function canList(path: string, config: ServeConfig): boolean {
  const route = findRoute(path, config)
  if (!route) return false
  return route.listing !== false
}

/** Check if a specific name is included in the listing filter. */
export function isNameListed(name: string, route: RouteConfig): boolean {
  if (route.listing === true) return true
  if (route.listing === false) return false
  return route.listing.includes(name)
}

/** Check if file downloads are allowed for this path. */
export function canDownload(path: string, config: ServeConfig): boolean {
  const route = findRoute(path, config)
  if (!route) return false
  return route.download
}
