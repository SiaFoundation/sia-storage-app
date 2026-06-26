# Sia Storage (Rust)

The Rust implementation of Sia Storage: the core, the apps and crates built on it, and the platform adapters. It stays compatible with the TypeScript app: the indexer wire formats and the SQLite schema match byte for byte, and the sync engine runs the same algorithm. Both clients share one indexer and one local database, so a Rust client and a TypeScript client can sync the same account and converge on the same state.

The Cargo workspace root is this `crates/` directory. Run the commands below from here.

## Build

| Command | What it does |
| --- | --- |
| `cargo build` | Debug build of the workspace. |
| `cargo build --release` | Release build. |

## Test and lint

Run these before a change lands. CI runs the same set:

```
cargo fmt --all --check && \
cargo test --workspace --lib --bins --tests && \
cargo clippy --workspace --all-targets -- -D warnings
```

Each crate's integration tests are consolidated into a single `tests/it/` binary, and timer cadences are shortened under test via `SIA_TEST_*_MS`, so the suite runs in seconds. To run one test, add a substring filter to the `cargo test` line. To compile without running, add `--no-run`. Doctests are not in the gate; run them on demand with `cargo test --workspace --doc`.

On macOS the first run after a relink is slow, because XProtect rescans each binary single-threaded. Clear it once: add your terminal under System Settings, Privacy and Security, Developer Tools, then restart it.
