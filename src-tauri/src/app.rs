// Tauri glue layer. Imports `tauri` and assembles the Builder. Domain logic
// must not live here — call into `emdash_dev::*` (lib.rs) modules instead.

use specta_typescript::Typescript;
use tauri_specta::{collect_commands, Builder};

use crate::commands;

/// Constructs the tauri-specta Builder with all `#[tauri::command]`+`#[specta::specta]`
/// functions registered. Used both by `run()` (the live app) and by the binding
/// export path (so the generated TypeScript stays in lockstep with the Rust
/// command set). Keep this list as the single source of truth — every command
/// added under `src/commands/` must be appended here.
pub fn build_specta() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new().commands(collect_commands![
        commands::greet::greet,
        commands::path::get_path,
    ])
}

/// Path the generated bindings get written to (relative to `CARGO_MANIFEST_DIR`,
/// which is `src-tauri/`). The renderer imports from here.
pub const BINDINGS_PATH: &str = "ui/src/bindings.ts";

/// Writes the TypeScript bindings file. Invoked at debug-mode startup so live
/// dev edits regenerate bindings, and from `bin/export-bindings` so CI can
/// verify the committed file is up to date without launching a webview.
pub fn export_bindings() -> Result<(), Box<dyn std::error::Error>> {
    let path = format!("{}/{}", env!("CARGO_MANIFEST_DIR"), BINDINGS_PATH);
    build_specta().export(Typescript::default(), &path)?;
    Ok(())
}

pub fn run() {
    // Warm the login-shell env capture before the webview opens, so the first
    // `get_path` invoke from the renderer hits the OnceLock cache (~free)
    // rather than blocking for up to 5 s while we spawn `$SHELL -ilc env`.
    let _ = emdash_dev::shell_env::apply_login_shell_env_to_process();

    let specta_builder = build_specta();

    #[cfg(debug_assertions)]
    {
        if let Err(err) = export_bindings() {
            eprintln!("[emdash-dev] warning: failed to export TS bindings: {err}");
        }
    }

    tauri::Builder::default()
        .invoke_handler(specta_builder.invoke_handler())
        .setup(move |app| {
            specta_builder.mount_events(app);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running emdash-dev");
}
