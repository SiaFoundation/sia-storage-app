#!/usr/bin/env bun

/**
 * Creates a new timestamped migration file.
 *
 * Usage:
 *   bun scripts/create-migration.ts <description> [--app mobile]
 *
 * Examples:
 *   bun scripts/create-migration.ts add_kv_table
 *   bun scripts/create-migration.ts keychain_fix --app mobile
 *
 * Without --app, creates in packages/core/src/db/migrations/ (shared).
 * With --app mobile, creates in apps/mobile/src/db/migrations/ (mobile-only).
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const args = process.argv.slice(2)
let description: string | undefined
let app: string | undefined

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--app') {
    app = args[++i]
  } else if (!description) {
    description = args[i]
  }
}

if (!description) {
  console.error(
    'Usage: bun scripts/create-migration.ts <description> [--app mobile]',
  )
  process.exit(1)
}

// Validate description: lowercase, underscores, digits only
if (!/^[a-z][a-z0-9_]*$/.test(description)) {
  console.error(
    'Description must be lowercase snake_case (letters, digits, underscores)',
  )
  process.exit(1)
}

const now = new Date()
const timestamp = [
  now.getFullYear(),
  String(now.getMonth() + 1).padStart(2, '0'),
  String(now.getDate()).padStart(2, '0'),
  '_',
  String(now.getHours()).padStart(2, '0'),
  String(now.getMinutes()).padStart(2, '0'),
  String(now.getSeconds()).padStart(2, '0'),
].join('')

const id = `${timestamp}_${description}`
const fileName = `${id}.ts`

const root = resolve(import.meta.dirname, '..')
let dir: string
let importPrefix: string

if (app === 'mobile') {
  dir = resolve(root, 'apps/mobile/src/db/migrations')
  importPrefix = '@siastorage/core/adapters'
} else {
  dir = resolve(root, 'packages/core/src/db/migrations')
  importPrefix = '../../adapters/db'
}

if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true })
}

const exportName = `migration_${id}`
const content = `import type { DatabaseAdapter } from '${importPrefix}'
import type { Migration } from '${app === 'mobile' ? '@siastorage/core/db' : '../types'}'

async function up(db: DatabaseAdapter): Promise<void> {
  // TODO: implement migration
}

export const ${exportName}: Migration = {
  id: '${id}',
  description: 'TODO: describe this migration.',
  up,
}
`

const filePath = resolve(dir, fileName)
writeFileSync(filePath, content)

console.log(`Created: ${filePath}`)
console.log(`\nNext steps:`)
console.log(`1. Implement the up() function in the new file`)
console.log(
  `2. Add the export to ${app === 'mobile' ? 'apps/mobile/src/db/migrations/index.ts' : 'packages/core/src/db/migrations/index.ts'}`,
)
