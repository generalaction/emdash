//! emdash-dev — Tauri 2 + Rust rewrite of emdash.
//!
//! This crate's root MUST NOT depend on Tauri app handles or webview-runtime
//! types. The Tauri-specific glue (builder, command attributes, capability
//! wiring) lives in the binary module tree rooted at `main.rs`, not here. This
//! keeps `bin/emdash-cli` pointed at the same domain modules the app uses and
//! lets those modules be unit-tested without a webview runtime.
//!
//! See `docs/decisions/0001-initial-scaffold.md` for the rationale.

pub mod greeting;
pub mod shell_env;
