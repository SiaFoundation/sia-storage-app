---
applyTo: 'apps/desktop/**'
---

# macOS desktop app

Three processes: the Electron app, the daemon the app starts, and the sandboxed
File Provider extension the system loads. They cannot log to the same place, so
the rules differ by destination.

## Logging from the app and the daemon

Both write files in the daemon's data directory, `~/.sia` unless `SIA_DATA_DIR`
says otherwise, through `@siastorage/logger`, taking a scope, a snake_case event
name and a field object. Nothing forwards them, and they leave the machine only
when someone attaches them to a report, so name the directory, socket or
identifier a message is about: "handoff directory is not writable" without
saying which directory is not a diagnostic.

## Logging from the extension

The extension is sandboxed and cannot reach those files, so it logs to
`os_log`. Interpolated values redact to `<private>` off-device by default, and
a sysdiagnose carries the persisted lines off the machine, so the default is
the safe one and `.public` is a decision.

Log a failure through `Logger.failure`, or `Logger.attemptFailed` where a retry
is expected to clear it, never by interpolating an error. Both take the event as
a `StaticString`, which the compiler will only accept as a literal, and leave
the reason redacted. Error text reaching the extension is the daemon's, and the
daemon quotes container paths, which hold the account name. Marking anything
else `.public` is fine only for a value that cannot carry user data: a count, a
state, a version, or a provider identifier.

Levels are not interchangeable. `notice` and `error` persist to disk, `info` is
held in memory and dropped, and `debug` is off until someone streams it.

## Errors that reach the user

`mapError` decides what Finder puts in an alert, and passes several messages
through verbatim rather than replacing them. An error string that can reach it
must carry no path and no identifier.

## The daemon

The daemon outlives the app. Started detached, it survives a crash, so the one
answering the socket at launch can be from an earlier install or a terminal.
The app asks it which build it is and who started it (`Daemon.reconcile`):
it keeps one of its own build, replaces one an earlier desktop install
started, and asks before stopping one started from a terminal or too old to
say. Quitting stops only a daemon the app owns, one it started or one a
desktop app started, so code assuming the app owns every daemon it finds is
wrong for a terminal's.

## Swift

Swift is here only where the OS requires it: the sandboxed extension, which
cannot be Electron, and the helper bundle carrying the entitlement to add the
Finder domain. New surface goes in TypeScript.

## Releases

`build/release.ts` is the build CI runs: bundle, sign, notarize and staple the
app, zip it for the updater, then wrap it in a disk image and notarize and
staple that. It installs nothing. When `RELEASE_TAG` is set the tag is
the version, not `package.json`: a stable `desktop/vX.Y.Z` tag is created on
the release candidate's commit, where `package.json` still reads `X.Y.Z-rc.N`.

## Updates

The beta and shipping builds update themselves from the repository's GitHub
releases through Electron's autoUpdater. On macOS that is Squirrel, which
accepts only a bundle meeting the running one's code signing requirement, and
that requirement names the bundle id and the team. That is why a stable tag
builds the beta app as well as the shipping one: a beta install takes every
desktop release, and could not take a shipping zip. dev and test builds name
no `SIA_UPDATE_CHANNEL` by default, so they never check.

An update swaps the bundle under a daemon and an extension that may both
outlive it, and the daemon refuses a handshake from an extension built for
another daemon version. The relaunched app replaces a daemon the previous
build started (`Daemon.reconcile`), and the extension exits when a handshake
fails and the plist on disk names a different daemon version than it loaded,
so fileproviderd starts the new binary.

To try an update against a local server, package a dev or test build with
`SIA_UPDATE_CHANNEL` set and launch it with `SIA_UPDATE_FEED` naming the
server's releases list.
