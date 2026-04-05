import { execSync } from 'child_process'
import { readFileSync, unlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const changelogs = [
  { name: 'core', path: 'packages/core/CHANGELOG.md' },
  { name: 'logger', path: 'packages/logger/CHANGELOG.md' },
  { name: 'mobile', path: 'apps/mobile/CHANGELOG.md' },
  { name: 'web', path: 'apps/web/CHANGELOG.md' },
  { name: 'desktop', path: 'apps/desktop/CHANGELOG.md' },
  { name: 'cli', path: 'apps/cli/CHANGELOG.md' },
]

function getLatestEntry(filePath: string): {
  version: string
  body: string
} | null {
  let content: string
  try {
    content = readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
  const lines = content.split('\n')
  const start = lines.findIndex((l) => l.startsWith('## '))
  if (start === -1) return null
  const version = lines[start]
    .replace(/^## /, '')
    .replace(/\s*\(.*\)/, '')
    .trim()
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '))
  const body = lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join('\n')
    .trim()
  return body ? { version, body } : null
}

function wasChangedFromMain(filePath: string): boolean {
  try {
    const result = execSync(`git diff main -- "${filePath}"`, {
      encoding: 'utf-8',
    })
    return result.trim().length > 0
  } catch {
    return false
  }
}

const sections: string[] = []
for (const { name, path } of changelogs) {
  if (!wasChangedFromMain(path)) continue
  const entry = getLatestEntry(path)
  if (entry) {
    sections.push(`## ${name} ${entry.version}\n\n${entry.body}`)
  }
}

const body = `${sections.join('\n\n')}\n\n---\nMerging this PR will create a GitHub release.`

const title = 'chore: release'
const bodyFile = join(tmpdir(), 'release-pr-body.md')
writeFileSync(bodyFile, body)

try {
  try {
    execSync(`gh pr create --base main --title "${title}" --body-file "${bodyFile}"`, {
      stdio: 'inherit',
    })
  } catch {
    execSync(`gh pr edit --title "${title}" --body-file "${bodyFile}"`, {
      stdio: 'inherit',
    })
  }
} finally {
  try {
    unlinkSync(bodyFile)
  } catch {}
}
