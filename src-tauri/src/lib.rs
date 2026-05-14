//! emdash-dev — Tauri 2 + Rust rewrite of emdash.
//!
//! Modules split into `DOMAIN_MODULES` (tauri-runtime-free) and
//! `TAURI_GLUE_MODULES` (intentionally tauri-aware), enforced by
//! `tests/domain_boundaries.rs`. See ADR-0001 for the rationale.

pub mod bindings_parser;
pub mod commands;
pub mod db;
pub mod greeting;
pub mod secrets;
pub mod shell_env;
pub mod tauri_bindings;
