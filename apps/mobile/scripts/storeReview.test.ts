import { expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

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
