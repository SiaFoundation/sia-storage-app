/**
 * Sends a checkout to the Windows VM. Code goes over as a git bundle the VM
 * fetches from, never as a push to a remote, and lands in a worktree of the
 * checkout's own on the VM's Dev Drive.
 *
 * Uncommitted work, untracked files included and ignored ones left out, goes
 * into a commit built from a copy of the index, so the user's branch, index
 * and stash are left as they are. The commit is held by a ref under
 * `refs/sim/windows/` so the bundle can name it.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REPO_ROOT } from '../session'
import { GUEST, psQuote, WINDOWS_HOME, type WindowsHost } from './host'

/**
 * Brings the checkout's worktree in the VM to the working tree here, sending
 * only the commits the VM lacks. Returns the commit and the worktree.
 */
export async function syncCheckout(
  host: WindowsHost,
  checkout: string,
): Promise<{ commit: string; worktree: string }> {
  const commit = snapshotWorkingTree(checkout)
  const ref = `refs/sim/windows/${checkout}`
  const worktree = GUEST.worktree(checkout)
  const has = await host.ps(
    `git -C ${psQuote(GUEST.repo)} cat-file -e '${commit}^{commit}'`,
    30_000,
  )
  if (has.exitCode !== 0) {
    const basis = await sentBefore(host, checkout)
    const bundle = join(tmpdir(), `sia-sim-${checkout}.bundle`)
    rmSync(bundle, { force: true })
    git(['bundle', 'create', bundle, ref, ...(basis ? [`^${basis}`] : [])])
    const remote = `${GUEST.incoming}\\${checkout}.bundle`
    await host.copyTo(bundle, remote)
    rmSync(bundle, { force: true })
    await host.mustPs(
      `git -C ${psQuote(GUEST.repo)} fetch --quiet ${psQuote(remote)} '+${ref}:refs/sim/${checkout}'`,
      'Fetching the bundle',
    )
    writeFileSync(sentFile(checkout), commit)
  }
  await host.mustPs(
    `
$wt = ${psQuote(worktree)}
if (Test-Path (Join-Path $wt '.git')) {
  git -C $wt checkout --quiet --force --detach ${commit}
  if ($LASTEXITCODE) { throw 'checkout failed' }
  git -C $wt clean --quiet -fd
} else {
  git -C ${psQuote(GUEST.repo)} worktree add --detach $wt ${commit}
  if ($LASTEXITCODE) { throw 'worktree add failed' }
}`,
    'Checking out',
  )
  return { commit, worktree }
}

/** The commit last sent for this checkout, if both sides still have it, for an incremental bundle. */
async function sentBefore(host: WindowsHost, checkout: string): Promise<string | null> {
  const file = sentFile(checkout)
  if (!existsSync(file)) return null
  const sha = readFileSync(file, 'utf8').trim()
  if (
    Bun.spawnSync(['git', 'cat-file', '-e', `${sha}^{commit}`], { cwd: REPO_ROOT }).exitCode !== 0
  ) {
    return null
  }
  const remote = await host.ps(
    `git -C ${psQuote(GUEST.repo)} cat-file -e '${sha}^{commit}'`,
    30_000,
  )
  return remote.exitCode === 0 ? sha : null
}

function sentFile(checkout: string): string {
  mkdirSync(join(WINDOWS_HOME, 'sent'), { recursive: true, mode: 0o700 })
  return join(WINDOWS_HOME, 'sent', checkout)
}

function git(args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}): string {
  const out = Bun.spawnSync(['git', ...args], {
    cwd: opts.cwd ?? REPO_ROOT,
    env: { ...process.env, ...opts.env },
  })
  if (out.exitCode !== 0) throw new Error(`git ${args[0]} failed: ${out.stderr.toString().trim()}`)
  return out.stdout.toString().trim()
}

/**
 * A commit holding the working tree in `repo` as it is, or HEAD when nothing
 * differs, pointed at by `refs/sim/windows/<checkout>`. The index copy keeps
 * the real index's file stamps, so `git add` rehashes only files that
 * changed. The commit is dated as HEAD is, so the same working tree always
 * makes the same commit, and a start with nothing changed sends and rebuilds
 * nothing.
 */
export function snapshotWorkingTree(checkout: string, repo = REPO_ROOT): string {
  const head = git(['rev-parse', 'HEAD'], { cwd: repo })
  const index = join(tmpdir(), `sia-sim-index-${checkout}-${process.pid}`)
  const realIndex = git(['rev-parse', '--path-format=absolute', '--git-path', 'index'], {
    cwd: repo,
  })
  try {
    writeFileSync(index, readFileSync(realIndex))
    const env = { GIT_INDEX_FILE: index }
    git(['add', '--all'], { cwd: repo, env })
    const tree = git(['write-tree'], { cwd: repo, env })
    const date = git(['log', '-1', '--format=%cI', 'HEAD'], { cwd: repo })
    const commit =
      tree === git(['rev-parse', 'HEAD^{tree}'], { cwd: repo })
        ? head
        : git(['commit-tree', tree, '-p', head, '-m', 'sim: uncommitted work'], {
            cwd: repo,
            env: { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
          })
    git(['update-ref', `refs/sim/windows/${checkout}`, commit], { cwd: repo })
    return commit
  } finally {
    rmSync(index, { force: true })
  }
}

/**
 * A key that changes when anything under `paths` changes at `commit`, read
 * from git's own tree ids so nothing is hashed twice. A build step whose key
 * matches the one stamped after its last run is skipped.
 */
export function inputKey(commit: string, paths: string[], repo = REPO_ROOT): string {
  const ids = paths.map((p) => git(['rev-parse', `${commit}:${p}`], { cwd: repo }))
  return createHash('sha256').update(ids.join('\n')).digest('hex').slice(0, 16)
}
