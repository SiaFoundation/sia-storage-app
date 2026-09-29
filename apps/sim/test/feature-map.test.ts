import { describe, expect, test } from 'bun:test'
import { Glob } from 'bun'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '../../..')
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')

/**
 * The feature map in apps/sim/FEATURES.md, as a list of (kind, name) pairs. A
 * segment of a line, split at semicolons, names its kind in its first word, such
 * as `scenarios` or `tables`, and each backticked name after it is of that kind.
 * `app.*` names and file paths are recognized wherever they appear.
 */
function mapEntries(): Array<{ kind: string; name: string }> {
  // Fenced blocks are recipes and commands, not names to check here.
  const section = read('apps/sim/FEATURES.md').replace(/```[\s\S]*?```/g, '')
  // Joined so a backticked name the formatter wrapped onto two lines stays whole.
  const flat = section.replace(/\n\s*/g, ' ')
  const entries: Array<{ kind: string; name: string }> = []
  for (const segment of flat.split(/;|- \*\*|\s- (?=[A-Z])/)) {
    const kind = /(?:^|:)\s*(screens|CLI|tables|services|scenarios|integration)\s/.exec(
      segment,
    )?.[1]
    for (const [, name] of segment.matchAll(/`([^`]+)`/g)) {
      if (name.startsWith('app.')) entries.push({ kind: 'app', name: name.slice(4) })
      else if (/\/.*\.\w+$/.test(name)) entries.push({ kind: 'path', name })
      else if (kind) entries.push({ kind, name })
    }
  }
  return entries
}

const appGroups = new Set(
  [...read('packages/core/src/app/service.ts').matchAll(/^ {2}(\w+): \{$/gm)].map((m) => m[1]),
)
const tables = new Set(
  readdirSync(join(ROOT, 'packages/core/src/db/migrations')).flatMap((file) =>
    [
      ...read(`packages/core/src/db/migrations/${file}`).matchAll(
        /CREATE TABLE (?:IF NOT EXISTS )?(\w+)/g,
      ),
    ].map((m) => m[1]),
  ),
)

const exists: Record<string, (name: string) => boolean> = {
  app: (name) => appGroups.has(name),
  path: (name) => existsSync(join(ROOT, name)),
  screens: (name) => existsSync(join(ROOT, `apps/mobile/src/screens/${name}Screen.tsx`)),
  CLI: (name) => existsSync(join(ROOT, `apps/cli/src/commands/${name}.ts`)),
  tables: (name) => tables.has(name),
  services: (name) => existsSync(join(ROOT, `packages/core/src/services/${name}.ts`)),
  scenarios: (name) => existsSync(join(ROOT, `apps/sim/scenarios/${name}.scenario.ts`)),
  integration: (name) => existsSync(join(ROOT, `apps/integration/test/${name}.test.ts`)),
}

describe('the feature map in apps/sim/FEATURES.md', () => {
  test('names only code, tables and tests that exist', () => {
    const entries = mapEntries()
    expect(entries.length).toBeGreaterThan(50)
    const missing = entries.filter((e) => !exists[e.kind](e.name))
    expect(missing).toEqual([])
  })

  test('recipes tap only labels and test ids the mobile app has', () => {
    const source = [...new Glob('**/*.{ts,tsx}').scanSync(join(ROOT, 'apps/mobile/src'))]
      .map((file) => read(`apps/mobile/src/${file}`))
      .join('\n')
    const blocks = [...read('apps/sim/FEATURES.md').matchAll(/```sim\n([\s\S]*?)```/g)].map(
      (m) => m[1],
    )
    const named = blocks.flatMap((block) =>
      [...block.matchAll(/--(?:label|id) (?:"([^"]+)"|(\S+))/g)].map((m) => m[1] ?? m[2]),
    )
    const unknown = [...new Set(named)].filter(
      (name) =>
        !name.includes('{') &&
        !source.includes(`"${name}"`) &&
        !source.includes(`'${name}'`) &&
        !source.includes(`\`${name}\``),
    )
    expect(unknown).toEqual([])
  })

  test('lists every scenario', async () => {
    const listed = new Set(
      mapEntries()
        .filter((e) => e.kind === 'scenarios')
        .map((e) => e.name),
    )
    const dir = join(ROOT, 'apps/sim/scenarios')
    const unlisted: string[] = []
    for await (const file of new Glob('**/*.scenario.ts').scan(dir)) {
      const name = file.replace(/\.scenario\.ts$/, '')
      if (!listed.has(name)) unlisted.push(name)
    }
    expect(unlisted).toEqual([])
  })
})
