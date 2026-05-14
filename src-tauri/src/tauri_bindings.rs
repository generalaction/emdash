//! Specta builder + TypeScript binding exporter. Lives in the lib so
//! `tests/wire_format.rs` can regenerate-and-diff in-memory without `cargo run`.

use std::path::Path;

use specta_typescript::Typescript;
use tauri_specta::{collect_commands, Builder};

use crate::commands;

/// Single source of truth for the command set. Used by `app::run` and
/// `export_bindings_to`.
pub fn build_specta() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new().commands(collect_commands![
        commands::greet::greet,
        commands::path::get_path,
        commands::secrets::set_secret,
        commands::secrets::get_secret,
    ])
}

pub const BINDINGS_PATH: &str = "ui/src/bindings.ts";

pub fn export_bindings_to<P: AsRef<Path>>(path: P) -> Result<(), Box<dyn std::error::Error>> {
    build_specta().export(Typescript::default(), path)?;
    Ok(())
}
