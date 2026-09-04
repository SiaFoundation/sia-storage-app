/*
 * Every alternate name for an instruction file is a symlink to a real
 * AGENTS.md. A directory rename moves the file but not the links that point
 * at it, and a stranded link silently stops loading that area's rules in the
 * tools that read it, so this is the only place the break surfaces. The
 * expected set is spelled out: a missing alias or one aimed at the wrong
 * area is as much a break as one that does not resolve.
 */

import * as fs from 'fs'
import * as path from 'path'

const root = path.resolve(__dirname, '..', '..', '..')

const EXPECTED: Record<string, string> = {
  'CLAUDE.md': 'AGENTS.md',
  'apps/desktop/CLAUDE.md': 'apps/desktop/AGENTS.md',
  'apps/integration/CLAUDE.md': 'apps/integration/AGENTS.md',
  'apps/mobile/CLAUDE.md': 'apps/mobile/AGENTS.md',
  'packages/core/CLAUDE.md': 'packages/core/AGENTS.md',
  'crates/CLAUDE.md': 'crates/AGENTS.md',
  '.github/instructions/core.instructions.md': 'packages/core/AGENTS.md',
  '.github/instructions/desktop.instructions.md': 'apps/desktop/AGENTS.md',
  '.github/instructions/integration-tests.instructions.md': 'apps/integration/AGENTS.md',
  '.github/instructions/mobile.instructions.md': 'apps/mobile/AGENTS.md',
  '.github/instructions/rust.instructions.md': 'crates/AGENTS.md',
}

const SKIP = new Set(['node_modules', '.git', '.build-cache', 'ios', 'android', 'target', 'out'])

function findLinks(
  dir: string,
  matches: (name: string) => boolean,
  found: string[] = [],
): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) findLinks(full, matches, found)
    else if (matches(entry.name)) found.push(path.relative(root, full))
  }
  return found
}

describe('instruction file links', () => {
  it.each(Object.entries(EXPECTED))('%s resolves to %s', (link, target) => {
    const full = path.join(root, link)
    expect(fs.lstatSync(full).isSymbolicLink()).toBe(true)
    expect(fs.realpathSync(full)).toBe(fs.realpathSync(path.join(root, target)))
  })

  it('no alias exists outside the expected set', () => {
    const found = [
      ...findLinks(root, (name) => name === 'CLAUDE.md'),
      ...findLinks(path.join(root, '.github'), (name) => name.endsWith('.instructions.md')),
    ]
    expect(found.sort()).toEqual(Object.keys(EXPECTED).sort())
  })
})
