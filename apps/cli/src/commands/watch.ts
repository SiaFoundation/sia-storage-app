import { resolve } from 'node:path'
import { existsSync, statSync } from 'node:fs'
import { getPaths } from '@siastorage/node-adapters'
import { daemonCommand } from '../daemon/supervisor'
import { c } from '../lib/format'

export async function watchAddCommand(
  dataDir: string,
  source: string,
  opts: { dir?: string; pattern?: string; appendId?: boolean },
) {
  const absSource = resolve(source)

  if (!existsSync(absSource)) {
    console.error(`Source directory does not exist: ${absSource}`)
    process.exit(1)
  }
  if (!statSync(absSource).isDirectory()) {
    console.error(`Source is not a directory: ${absSource}`)
    process.exit(1)
  }

  const p = getPaths(dataDir)
  try {
    await daemonCommand(p, 'watch:add', {
      source: absSource,
      targetDir: opts.dir ?? 'watched',
      pattern: opts.pattern,
      appendId: opts.appendId,
    })
    console.log(`Watching ${c.cyan(absSource)}`)
    console.log(`  target: ${opts.dir ?? 'watched'}`)
    if (opts.pattern) console.log(`  pattern: ${opts.pattern}`)
    if (opts.appendId) console.log(`  append ID: yes`)
  } catch (e) {
    console.error(`Failed: ${e instanceof Error ? e.message : String(e)}`)
    process.exit(1)
  }
}

export async function watchRmCommand(dataDir: string, source: string) {
  const absSource = resolve(source)
  const p = getPaths(dataDir)

  try {
    await daemonCommand(p, 'watch:rm', { source: absSource })
    console.log(`Removed watch: ${c.dim(absSource)}`)
  } catch (e) {
    console.error(`Failed: ${e instanceof Error ? e.message : String(e)}`)
    process.exit(1)
  }
}

export async function watchListCommand(dataDir: string) {
  const p = getPaths(dataDir)

  try {
    const result = (await daemonCommand(p, 'watch:list')) as {
      rules: Array<{
        source: string
        targetDir: string
        pattern?: string
        appendId?: boolean
      }>
    }

    if (result.rules.length === 0) {
      console.log(c.dim('No watch rules configured.'))
      console.log(c.dim('Add one with: sia watch add <directory> --dir <target>'))
      return
    }

    for (const rule of result.rules) {
      console.log(`${c.cyan(rule.source)} → ${c.green(rule.targetDir)}`)
      if (rule.pattern) console.log(`  pattern: ${rule.pattern}`)
      if (rule.appendId) console.log(`  append ID: yes`)
    }
  } catch (e) {
    console.error(`Failed: ${e instanceof Error ? e.message : String(e)}`)
    process.exit(1)
  }
}
