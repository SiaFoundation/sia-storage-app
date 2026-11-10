import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inputKey, snapshotWorkingTree } from '../src/windows/sync'

const git = (repo: string, ...args: string[]) =>
  Bun.spawnSync(['git', ...args], { cwd: repo })
    .stdout.toString()
    .trim()

describe('snapshotWorkingTree', () => {
  let repo: string

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'sim-sync-'))
    git(repo, 'init', '-q')
    git(repo, 'config', 'user.email', 'sim@test')
    git(repo, 'config', 'user.name', 'sim')
    writeFileSync(join(repo, 'a.txt'), 'one\n')
    writeFileSync(join(repo, '.gitignore'), 'ignored.txt\n')
    git(repo, 'add', '.')
    git(repo, 'commit', '-qm', 'base')
  })

  afterAll(() => rmSync(repo, { recursive: true, force: true }))

  test('is HEAD itself when the working tree has no changes', () => {
    expect(snapshotWorkingTree('t', repo)).toBe(git(repo, 'rev-parse', 'HEAD'))
  })

  test('holds edits and untracked files, leaves out ignored ones, and leaves branch, index and status alone', () => {
    writeFileSync(join(repo, 'a.txt'), 'two\n')
    writeFileSync(join(repo, 'new.txt'), 'new\n')
    writeFileSync(join(repo, 'ignored.txt'), 'secret\n')
    // `git status` refreshes the index's file stamps and writes it, so it runs
    // before the index is read rather than between the read and the compare.
    const status = git(repo, 'status', '--porcelain')
    const index = readFileSync(join(repo, '.git', 'index'))

    const commit = snapshotWorkingTree('t', repo)

    expect(git(repo, 'show', `${commit}:a.txt`)).toBe('two')
    expect(git(repo, 'show', `${commit}:new.txt`)).toBe('new')
    expect(git(repo, 'ls-tree', '--name-only', commit)).not.toContain('ignored.txt')
    expect(git(repo, 'rev-parse', `${commit}^`)).toBe(git(repo, 'rev-parse', 'HEAD'))
    expect(git(repo, 'rev-parse', 'refs/sim/windows/t')).toBe(commit)
    expect(readFileSync(join(repo, '.git', 'index')).equals(index)).toBe(true)
    expect(git(repo, 'status', '--porcelain')).toBe(status)
  })

  test('makes the same commit for the same working tree, so an unchanged start sends nothing', async () => {
    const first = snapshotWorkingTree('t', repo)
    await Bun.sleep(1100)
    expect(snapshotWorkingTree('t', repo)).toBe(first)
  })
})

describe('inputKey', () => {
  test('changes only when something under the given paths changes', () => {
    const repo = mkdtempSync(join(tmpdir(), 'sim-key-'))
    try {
      git(repo, 'init', '-q')
      git(repo, 'config', 'user.email', 'sim@test')
      git(repo, 'config', 'user.name', 'sim')
      Bun.spawnSync(['mkdir', '-p', join(repo, 'app'), join(repo, 'docs')])
      writeFileSync(join(repo, 'app', 'x.ts'), '1\n')
      writeFileSync(join(repo, 'docs', 'y.md'), '1\n')
      git(repo, 'add', '.')
      git(repo, 'commit', '-qm', 'one')
      const before = inputKey('HEAD', ['app'], repo)
      writeFileSync(join(repo, 'docs', 'y.md'), '2\n')
      git(repo, 'commit', '-qam', 'docs')
      expect(inputKey('HEAD', ['app'], repo)).toBe(before)
      writeFileSync(join(repo, 'app', 'x.ts'), '2\n')
      git(repo, 'commit', '-qam', 'app')
      expect(inputKey('HEAD', ['app'], repo)).not.toBe(before)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })
})
