---
applyTo: 'apps/sim/**'
---

# sim

Runs the real apps, CLI daemons, the mobile app on iOS simulators and Android
emulators, and the desktop app on this Mac, as devices on one shared mock
network. It is the main way to develop, debug and verify a change to how the
apps behave, on one device as much as on several. Unit and integration tests run
the core on Node, and a device also runs what they leave out, such as the mobile
app's native modules, its SQLite driver and its screens, the daemon's process
and socket, and the desktop app's Finder extension. Sim drives each device and
reads its database, logs and accessibility tree.

The mock network (`packages/mock-network`) replaces the Sia SDK and indexer and
follows indexd's object API: events publish once a second at whole-second
positions, and a pin or edit of a deleted object fails the way indexd fails it.
Every device talks to it over HTTP, so it keeps one set of objects and one event
stream for all of them, persisted under the session directory. Nothing touches a
real account.

## Working on a feature

Read the feature's entry in `FEATURES.md` first. It names the code the feature
lives in, the state that shows it worked and the tests that cover it, and gives
recipes that reach it on a phone.

- **Develop.** Start the devices the feature runs on,
  `bun sim up --cli= --ios phone` for one phone, `bun sim up --cli dev` for one
  daemon or `bun sim up --cli= --desktop mac` for the desktop app, and seed some
  files. Exercise the feature through its UI (`device ui`, `tap`, `type`,
  `expect`), its Finder folder (`device finder`), its AppService call (`call`)
  or a `sia` command (`sia`), then read what it did with `sql`, `library` and
  `logs`. Do this after each change.
- **Debug.** Reproduce a report on a device before reading code for its cause.
  The tables, the log and the accessibility tree show what the app did: `logs`
  narrows the log by `--scope`, `--level` and `--grep` and follows it with `-f`,
  and `schema` and `sql` read the database. `net` fails, slows or cuts the
  network the way a bad connection does.
- **Verify.** Before calling a change done, exercise it on every platform it
  runs on. A change meant to be faster shows `bench` or `perf` numbers from
  before and after. Behavior that crosses devices or processes gets a scenario.
  Logic inside the core also gets an integration test in `apps/integration`,
  which is faster and deterministic.
- **Report.** A fix found or reproduced in sim keeps a scenario, or an
  integration test where one process is enough, that fails before the fix, and
  its PR description takes the shape in [Reporting a fix](#reporting-a-fix).

A CLI device runs the daemon from source, so `device stop` and `device start`
pick up a change, and so does a desktop device's daemon. A phone's JavaScript
comes from Metro, so a JS change needs no rebuild, and `device stop` and
`device start` relaunch the app on it.

## Devices

| Kind      | What runs                                                           | Needs                                                                      |
| --------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `cli`     | a CLI daemon from source, which is also the desktop app's daemon    | nothing                                                                    |
| `ios`     | the mobile debug build on its own iOS simulator                     | `bun run mobile:dev:ios:simulator -- --no-run` once                        |
| `android` | the mobile debug build on its own emulator                          | `bun run mobile:dev:android:emulator -- --no-run` once, and a system image |
| `desktop` | the installed desktop test build on this Mac, and its Finder folder | macOS, and `bun run desktop:package test` once                             |

Phones load JavaScript from one Metro server per checkout, so a JS change needs
no rebuild. A native change needs the build command again. Simulators and
emulators are pooled per checkout and reused with the app wiped, so only the
first phone after a reboot pays for a cold boot.

Emulators run an AVD named `sia-sim`, which sim creates from the newest
installed system image with an 8 GB data partition. The app holds photo imports
while less than 2 GB is free, which an AVD in daily use can fall below.
`SIM_ANDROID_AVD` names a different AVD.

Booted phones share one memory budget across every checkout on the machine,
`SIM_PHONE_MEMORY_GB`, or 40% of installed memory when that is unset. A phone
that would take them past it waits, as does any phone while macOS reports
memory pressure, and takes a pooled phone another session hands back in the
meantime. The first phone boots whatever the budget, but waits like any other
while macOS reports memory pressure.

A desktop device is the installed test build of the desktop app, launched with
the session's network and a library in its device directory, and with its daemon
running from source. A change to the Electron main process or the File Provider
extension needs `bun run desktop:package test` again. Its first start removes
the build's Finder folder, and so everything macOS listed or downloaded for it,
and handing the device back removes it again. The test build has one Finder
folder per Mac, so one desktop device runs at a time across every checkout, and
a second waits for the first. `SIM_DESKTOP_CONTEXT` launches another build
context, such as `dev`, which resets that build's Finder folder the same way.
It refuses `prod` and `beta`, the builds people use.

macOS syncs the test build's Finder folder only once it has been switched on
under File Providers in System Settings, General, Login Items & Extensions.
Until then the device stops at start and says so.

## Interactive use

From the repo root:

```
bun sim up                              # network + CLI devices phone and laptop
bun sim up --cli laptop --ios phone     # or --android droid
bun sim seed phone -n 100 --size 64k    # unique files, added through the app
bun sim converge                        # waits until every device agrees
bun sim library laptop                  # a device's files as sim compares them
bun sim call phone files.renameFile <id> new.txt   # any AppService method
bun sim sql laptop "SELECT count(*) FROM files"    # read-only, the app's own DB
bun sim sia laptop -- mv a.txt docs/    # any `sia` command as a CLI device
bun sim device kill phone               # then `device start phone`
bun sim device background phone         # and `foreground`
bun sim device locks phone              # iOS: SQLite locks it holds, read from the Mac
bun sim device ui phone                 # visible elements, for writing selectors
bun sim device tap phone --label "Add files"
bun sim up --cli laptop --desktop mac     # the desktop test build on this Mac
bun sim device finder mac               # its Finder folder, for cp, mv, ls and rm
bun sim net offline laptop              # also: online, latency, rate, fail
bun sim net objects                     # what the indexer holds
bun sim seed laptop --type image -n 2   # real files of a type, named the risky ways
bun sim device type phone --label "Search files" report --submit
bun sim device expect phone --text "No results found" # or --gone
bun sim device scroll-to phone --label Developers
bun sim device swipe phone down --text "Import from Files" # closes a sheet
bun sim device show phone               # the Simulator window
bun sim logs phone --scope uploader --level warn -f # filtered, following
bun sim perf phone --seconds 10         # the app process's CPU and memory
bun sim bench phone files.query '{"order":"ASC"}' # call timings, p50 and p95
bun sim schema laptop files             # tables with row counts, or columns
bun sim device capture phone before     # library, log, screen
bun sim transcript                      # every command so far, to reproduce
bun sim device tray mac                 # the status popover
bun sim device finder-state mac a.png   # downloaded, extension, type
bun sim device download mac a.png       # reads it through Finder
bun sim down --clean
```

`down` keeps each phone's simulator or emulator leased, so the next `up` resumes it
with its data. `down --clean` hands it back to the pool and deletes the session.

Each checkout has its own session under `/tmp/sia-sim/<checkout>`, so parallel
worktrees never share a network. `--session <name>` picks another. Sessions use
shortened sync and upload timers. `bun sim up --real-timers` uses the production
ones.

The iOS simulator suspends a backgrounded app but never kills it for holding a
database lock the way a phone does (0xdead10cc). Check the cause instead: once
the phone has suspended, `locks` must show no write lock and no WAL read slot.
The kill itself needs a real phone.

## Scenarios

A scenario is a file in `scenarios/` ending `.scenario.ts`. It declares its
devices as `cli`, `phone` or `desktop`, runs steps, and records checks. Each
device arrives typed by its kind, so a `cli` device has `cli()` and `stage()`, a
`phone` has `ui()` and `importFiles()`, and a `desktop` device has `finderList()`,
`finderRead()`, `finderWrite()`, `finderRename()`, `finderRemove()`,
`isCloudOnly()` and `extensionLog()`.

`bun sim run [filter]` gives each scenario a fresh network and devices and writes
a report to `/tmp/sia-sim/runs/<run id>/`. `--jobs N` runs N at once, and
`--phone android` runs the `phone` devices on Android instead of iOS. A check
that fails, or a wait for the apps that times out, is a FAIL. A scenario that
never reaches its checks is an ERROR: a device did not start, a `precondition`
did not hold, or a call threw. Its error says which, and it can be the product
or the harness. Set up the situation under test with `precondition`, such as
an upload being in flight before a kill, so a missed window reads as ERROR
rather than as a product failure.
A scenario with a `desktop` device on a machine that cannot run one, off macOS
or without the test build installed, is a SKIP, which does not fail the run.

A failed scenario keeps its session directory, with every device's database,
log and a screenshot per phone, and the report names it. A phone's `ui.log`
there lists each UI action the scenario took with how long it ran, which shows
which tap or wait used a step's time. A launch whose app
never connects leaves `launch-<n>.png` in the phone's device directory beside
the system's log for that launch, logcat on Android and the simulator's log
with any crash report on iOS, and the error quotes the first crash line found. A phone app that crashes
while a scenario is setting it up is relaunched once, and the report and the
run's summary line list the crash. A crash when the scenario itself starts
the app, such as a relaunch after a kill, fails as usual.
With `SIM_PROGRESS_FILE` set, `bun sim run` rewrites that file as JSON with
the count per verdict, the scenarios running and the latest result, for a CI
step that cannot read the job's log until the job ends. `bun sim prune` stops
what an interrupted run in this checkout left running and removes the sessions
of every run that has finished, including those kept for inspection. `--all`
also stops and removes the checkout's named sessions, including the one
`bun sim up` started, stops its Metro and Appium servers, deletes its
simulators, stops its emulators, and quits the desktop test build and removes
its Finder folder when no session holds it. It refuses while one of the
checkout's runs is in progress, and with `--force` it prunes that run too,
for CI cleanup after a cancelled job or a run that was killed. Prune never
touches another checkout's sessions.

A run shuts down its phones and stops Metro and Appium when it finishes,
unless it is given `--keep-devices` or another run in this checkout is still
going. Every sim command first shuts down this checkout's pooled phones that
no session has used for 15 minutes, which covers phones a kept or interrupted
run left booted. A phone a session still holds after `down` stays booted until
`down --clean`.

A scenario that catches a bug nobody has fixed yet sets `knownBug` to a sentence
describing it. It reports KNOWN_BUG without failing the suite, and FIXED, which
does fail it, once the bug is gone, so whoever fixed it removes the line. A bug on
one phone platform only is given as `{ ios: '...' }` or `{ android: '...' }`.

A bug that shows on some runs only, such as a race a later diff in the same
stack fixes, is given as `intermittentBug` instead. A run where it shows
reports KNOWN_BUG and one where it does not reports PASS, never FIXED, since a
pass does not show a race is gone, so the diff with the fix removes the line.
The run's summary line counts these scenarios.

Both kinds need `bugShowsAs`, parts of the check labels or the wait the bug
fails, and a run with any other failure reports FAIL, so a new regression in
the same scenario is not taken for the bug.

A scenario that asserts what the apps do now, where nobody has decided that is
what they should do, sets `needsReview` to the decision needed. It passes or
fails as usual, and the report and the run's summary line list it.

- Checks are coded: a query, a library comparison, a network count, an element
  in the accessibility tree. A screenshot or a log line read by eye is not a
  check.
- Name a scenario and its checks with the behavior in plain words. The
  description says what the scenario proves.
- Drive devices through the app's own paths: `seed` and `addFile` add files the
  way each app does (the daemon's add on a CLI, the picker's import on a phone),
  and edits go through `call` on AppService methods. Use `network.inject` only
  to stand up state another device already published.
- A scenario that verifies a change you made is worth keeping. Add it here in
  the same diff.

When you report that something works across devices, cite the run id and the
commit in the report.

## CI and attestation

Every PR runs the CLI-device scenarios in CI. The phone suites run in CI only
when the `sim-mobile` label is added to a PR, weekly, or on demand, and a push
while one runs cancels it. A labelled run posts its result on the commit it
tested as the `sim/ios` and `sim/android` commit statuses, and the label comes
off when it ends. Running the workflow by hand takes scenario filters and a
platform, to try a fix on the runner without the whole suite. Every phone
run uploads its report and the sessions it kept, and the CLI-device run
uploads them when it fails.

`bun sim attest <ios|android|desktop>` runs that platform's suite on this
checkout and posts the same status from the local run. It refuses unless the
tracked files have no uncommitted changes and local HEAD is the PR's head, and
it posts nothing when the run is interrupted or skips a scenario. The release
PR needs `sim/ios` and `sim/android` on its head commit, and `sim/desktop` when
it changes the desktop app's version. Every other PR gets them as not required.

## Reporting a fix

A diff that changes how the apps behave shows the change in sim. The scenario
that shows the problem comes first, in the diff that adds it, with `knownBug`
describing what goes wrong, and the fix removes that line. The run before the
fix reports KNOWN_BUG and the run on it reports PASS. A change meant to make
something faster shows `bench` or `perf` numbers from before and after instead,
taken on the same device kind with the same load.

The PR description has one shape:

```
What was wrong: what a user saw, in a sentence or two.
Cause: the code responsible, in one sentence.
Fix: what the change does.

Reproduce with sim:
  the `bun sim transcript` lines from the session that showed it
Before: the run id and KNOWN_BUG, or the numbers
After: the run id and PASS, or the numbers
Screenshots: captures from `device capture`, when the problem shows on a screen
```

Screenshots come from phones and the desktop app's windows, never from Finder,
whose window shows every other folder on the Mac.
