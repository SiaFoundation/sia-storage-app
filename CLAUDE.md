@AGENTS.md

# Claude Code

`AGENTS.md` above is the contract: repo map, verification, how to run the app,
architecture, conventions, test tiers, changesets, comment rules, and the rule against
touching a remote without authorization. All of it applies here. This file adds only
what is specific to running inside a Claude Code session.

## Command output

Session context is finite, so a command that prints tens of thousands of lines has to be
backgrounded rather than run in the foreground.

Builds already handle this themselves: `bun run mobile:dev:*` prints a progress line and
writes the full output to `.build-cache/<target>/build.log`. Run them directly and read
that file if something fails.

Tests do not. `bun run test` runs jest across five packages and prints a line per suite,
so background it and read the `Test Suites:` and `Tests:` summary lines per
package rather than the stream. Background it for a second reason too: an open handle
from an async loop hangs the run instead of failing it, and a hung foreground run costs
the whole session. If output stops growing for 30 seconds or more, kill it and find the
leak.

Never leave a `.log` file in the repo. Write to `/tmp`.

A run that exits 0 with almost no output has not passed; it has failed to capture. Check
the line count against the summary lines before believing it.

## Fresh checkouts

`node_modules` is not shared between worktrees. After `bun install`, if core tests fail
with "Could not locate the bindings file" for `better-sqlite3`, build it:
`cd node_modules/better-sqlite3 && PYTHON=/usr/bin/python3 npm run build-release`.
`npm rebuild better-sqlite3` reports success without producing a binding.
