import { expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ready } from './storeReview'

// Runs the script itself, so a lost entry point fails here rather than in a
// scheduled run that does nothing and still passes.
test('Store Review runs and reports when no mobile final PR is open', () => {
  const bin = mkdtempSync(path.join(tmpdir(), 'store-review-'))
  try {
    const gh = path.join(bin, 'gh')
    writeFileSync(gh, '#!/bin/sh\necho "[]"\n')
    chmodSync(gh, 0o755)
    const run = Bun.spawnSync(['bun', path.join(import.meta.dir, 'storeReview.ts')], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    })
    expect(run.stdout.toString()).toContain('no mobile final PR is open')
    expect(run.exitCode).toBe(0)
  } finally {
    rmSync(bin, { recursive: true, force: true })
  }
})

test('Store Review marks the final PR ready as the release bot', () => {
  const bin = mkdtempSync(path.join(tmpdir(), 'store-review-'))
  const saved = {
    PATH: process.env.PATH,
    BOT_TOKEN: process.env.BOT_TOKEN,
    GH_TOKEN: process.env.GH_TOKEN,
  }
  try {
    const gh = path.join(bin, 'gh')
    writeFileSync(gh, `#!/bin/sh\necho "$GH_TOKEN $*" > ${bin}/call\n`)
    chmodSync(gh, 0o755)
    process.env.PATH = `${bin}:${saved.PATH}`
    process.env.BOT_TOKEN = 'bot-token'
    process.env.GH_TOKEN = 'workflow-token'
    ready(1117, [])
    expect(readFileSync(path.join(bin, 'call'), 'utf-8').trim()).toBe('bot-token pr ready 1117')
  } finally {
    Object.assign(process.env, saved)
    rmSync(bin, { recursive: true, force: true })
  }
})
