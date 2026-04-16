import type { CliApp } from '../../app'
import { getWatchRules, setWatchRules, type WatchRule } from '../../watch/service'
import type { IpcHandlerMap } from './index'

/** CRUD handlers for the daemon's directory-watch rule list. */
export function registerWatchHandlers(handlers: IpcHandlerMap, app: CliApp): void {
  handlers.set('watch:add', async (params) => {
    const rule = parseWatchRule(params)
    const rules = await getWatchRules(app)
    const idx = rules.findIndex((r) => r.source === rule.source)
    if (idx >= 0) {
      rules[idx] = rule
    } else {
      rules.push(rule)
    }
    await setWatchRules(app, rules)
    return { ok: true }
  })

  handlers.set('watch:rm', async (params) => {
    const source = params?.source as string | undefined
    if (!source) throw new Error('Missing source parameter')
    const rules = await getWatchRules(app)
    await setWatchRules(
      app,
      rules.filter((r) => r.source !== source),
    )
    return { ok: true }
  })

  handlers.set('watch:list', async () => ({
    rules: await getWatchRules(app),
  }))
}

function parseWatchRule(params: Record<string, unknown> | undefined): WatchRule {
  const source = params?.source as string | undefined
  if (!source) throw new Error('Missing source parameter')
  return {
    source,
    targetDir: (params?.targetDir as string) ?? 'watched',
    pattern: params?.pattern as string | undefined,
    appendId: (params?.appendId as boolean) ?? false,
  }
}
