# Rust tests

Rust's own tooling expects unit tests inline in `core/src/*.rs` (`#[cfg(test)] mod tests`) and integration tests under `core/tests/` — `cargo test` only discovers tests in those locations, not here. Rather than fight that convention, CodeLink's Rust tests live there:

- `core/src/security.rs`, `filesystem.rs`, `search.rs`, `process.rs`, `git.rs` each have a `#[cfg(test)]` module with unit tests.
- `core/tests/ipc_integration.rs` has end-to-end tests against the real compiled `codelink-core` binary over its actual stdio protocol.

Run them with `cargo test --manifest-path core/Cargo.toml` (or `npm run test:core` from the repo root). See [../../core/README.md](../../core/README.md) and [../../docs/development.md](../../docs/development.md).
