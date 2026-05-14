// Tauri command glue. Every command in this tree is a thin wrapper over a
// domain function from `emdash_dev::*` (the lib crate). Commands MUST NOT
// contain business logic — push it into a domain module so `bin/emdash-cli`
// and unit tests can reach it without Tauri.

pub mod greet;
pub mod path;
