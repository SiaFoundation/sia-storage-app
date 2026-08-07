---
applyTo: 'apps/desktop/**'
---

# macOS desktop app

Three processes: the Electron app, the daemon the app starts, and the sandboxed
File Provider extension the system loads. They cannot log to the same place, so
the rules differ by destination.

## Logging from the app and the daemon

Both write files in the daemon's data directory, `~/.sia` unless
`SIA_DATA_DIR` says otherwise: `desktop.log` and `daemon.log`.
Nothing forwards them, and they leave the machine only when someone attaches
them to a report, so name the directory, socket or identifier a message is
about: "handoff directory is not writable" without saying which directory is
not a diagnostic.

## Logging from the extension

The extension is sandboxed and cannot reach those files, so it logs to
`os_log`. Interpolated values redact to `<private>` off-device by default, and
a sysdiagnose carries the persisted lines off the machine, so the default is
the safe one and `.public` is a decision.

Log a failure through `Logger.failure`, never by interpolating an error. It
takes the event as a `StaticString`, which the compiler will only accept as a
literal, and leaves the reason redacted. Error text reaching the extension is
the daemon's, and the daemon quotes container paths, which hold the account
name. Marking anything else `.public` is fine only for a value that cannot
carry user data: a count, a state, a version, or a provider identifier.

## Errors that reach the user

`mapError` decides what Finder puts in an alert, and passes several messages
through verbatim rather than replacing them. An error string that can reach it
carries no path and no identifier.

## The daemon

The daemon outlives the app. Started detached, it survives a crash, and
quitting stops only a daemon this app started. The app attaches to whichever
daemon already answers the socket, so code assuming it owns the daemon's
lifetime is wrong on the second launch.

## Swift

Swift is here only where the OS requires it: the sandboxed extension, which
cannot be Electron, and the helper bundle carrying the entitlement to add the
Finder domain. New surface goes in TypeScript.
