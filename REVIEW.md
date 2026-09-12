# Review instructions

What to flag and what to leave alone. Conventions live in `AGENTS.md` and
each area's own; everything a reviewer must enforce is stated here.

## Reporting

Report every finding; never drop one for brevity or as already raised.
Route by whether the author must act before merge:

| Finding                                                     | Goes                |
| ----------------------------------------------------------- | ------------------- |
| Important, or a defect this diff introduced                 | its own thread      |
| A missing changeset                                         | its own thread      |
| Everything else: nits, cleanup, code the diff only revealed | one summary comment |
| The linter, formatter or type checker catches it            | nowhere             |

The summary comment is one comment headed `Follow-ups (non-blocking)`, one
line per item as `file:line` plus a sentence. It does not block a merge. Where
fixing A deletes B, post one thread.

Open the body with a tally: `1 important, 4 follow-ups`. When
nothing needs a fix before merge, say so; still post any follow-ups. The body addresses the author;
never describe their change back to them.

## Important means

Data corruption, a lost or resurrected file, two devices converging on
different state, an upload that reports success without bytes landing, a
migration an installed app cannot survive, blocking the JS thread on a path
the user waits on, a secret or recovery phrase in any log or error, a file
path in a message the user did not choose to send, or a comment stating a
wrong field list, state set, count or shape. Naming, structure and refactors
are never Important.

## Always check

- Facade boundary: app or service code calling `ops.*` or the SDK instead of
  `app.*`; SQL outside `packages/core/src/db/`.
- A behaviour defect with no test that would catch it: ask for the regression
  test in the same thread, and where a test passed with the bug in place, say
  why it passed.
- Integration tests that fake the app: `injectObject()` instead of
  `addFiles()`, writing `trashedAt`/`deletedAt` directly, forcing a sync tick.
- Duplicated implementation: name the existing function and what differs.
- A description or changeset claiming behaviour the diff does not contain, a
  codebase term used without saying what it is, or context the reader lacks.
- A user-facing app change, or a `core`/`logger` API change, with no
  changeset. `Closes` only on a stack's last PR.
- A changed query filter, join or order: `bun --cwd apps/benchmark bench`,
  and no filter or sort on an unindexed column.

## Comments

Flag a comment where it is wrong or misleading, never for being long: a
wrong field list or behaviour, edit-history narration ("now uses X",
"previously") outside a migration, a pointer to a file or plan the reader
cannot open, or a number nobody can confirm from the
code (a number the code fixes is fine). Do not count lines, in headers or
inline; length is an authoring rule in `AGENTS.md`. Flag the absence too: an
ordering constraint or platform workaround introduced with no why, and a
genuine-why comment deleted while its reason holds.

All prose including test names: flag an em-dash, an arrow, an aphorism where
a fact belongs, the "not just X, it's Y" pivot, and filler words such as
leverage, robust, seamless, comprehensive, simply (the full list is in
`AGENTS.md`; a word is fine where it is the codebase's own term). A test name
states the behaviour and matches what it asserts.

## Do not report

Anything CI enforces (`oxlint`, `oxfmt`, `tsc`, `knip`, cargo), formatting,
import order, extract-a-helper suggestions on correct code, generated files
and lockfiles.

## Verification bar

A behaviour claim needs a `file:line` citation, not an inference from a name;
for a race, name the two operations and the interleaving. Attribute findings
to a rule and quote it; an unattributable one is a general observation, label
it so.
