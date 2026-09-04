---
applyTo: 'crates/**'
---

# Rust core

`crates/sia-storage-core` is a port, not a fresh design. It shares one indexer and one
local database with the TypeScript client, so the SQLite schema and the indexer wire
format match byte for byte and the sync engine runs the same algorithm. A change that
alters either without the matching change in `packages/core` breaks cross-client sync.

- The Cargo workspace root is `crates/`. The gate is `cargo fmt --all --check`,
  `cargo test --workspace --lib --bins --tests`, and
  `cargo clippy --workspace --all-targets -- -D warnings`.
- Write idiomatic Rust, not transliterated TypeScript. Borrow where the TS returned a
  copy, use the type system where the TS used a runtime check, and return `Result`
  where the TS threw.
- Comments are for a Rust reader who has never seen the TypeScript. No porting
  narration, no comparisons to the TS implementation, no migration commentary.
