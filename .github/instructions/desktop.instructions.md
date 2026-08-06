---
applyTo: 'apps/desktop/**'
---

# macOS desktop app

The File Provider extension runs sandboxed in a process the system starts, and
cannot reach a log file of its own.

## Logging from the extension

The extension logs to `os_log`. Interpolated values redact to `<private>`
off-device by default, and a sysdiagnose carries the persisted lines off the
machine, so the default is the safe one and `.public` is a decision.

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

## Swift

Swift is here only where the OS requires it, and the extension is sandboxed so
it cannot be Electron. New surface goes in TypeScript unless the OS forces
otherwise.
