//! Tauri runtime glue. Domain logic stays in `emdash_dev::*` lib modules.

use std::path::PathBuf;
use std::sync::Arc;

use emdash_dev::db::Db;
use emdash_dev::pty::registry::Registry;
use emdash_dev::secrets::{master_key::OsKeyringMasterKey, Secrets};
use emdash_dev::tauri_bindings;
use tauri::Manager;

pub fn export_bindings_default() -> Result<(), Box<dyn std::error::Error>> {
    let path = format!(
        "{}/{}",
        env!("CARGO_MANIFEST_DIR"),
        tauri_bindings::BINDINGS_PATH
    );
    tauri_bindings::export_bindings_to(&path)
}

pub fn run() {
    // Warm shell-env on a background thread so the window opens immediately;
    // the OnceLock blocks any `get_path` caller until capture finishes.
    // `apply_*` mutates `std::env` (not thread-safe) — safe here because
    // Tauri's runtime threads haven't read env yet at this point.
    std::thread::spawn(|| {
        emdash_dev::shell_env::apply_login_shell_env_to_process();
    });

    let specta_builder = tauri_bindings::build_specta();

    #[cfg(debug_assertions)]
    {
        if let Err(err) = export_bindings_default() {
            eprintln!("[emdash-dev] warning: failed to export TS bindings: {err}");
        }
    }

    tauri::Builder::default()
        .invoke_handler(specta_builder.invoke_handler())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                if let Some(registry) = window.app_handle().try_state::<Arc<Registry>>() {
                    registry.drain();
                }
            }
        })
        .setup(move |app| {
            specta_builder.mount_events(app);

            let db_path = resolve_db_path(app.handle())?;
            if let Some(parent) = db_path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let db = Db::open(&db_path)?;
            let master = Arc::new(OsKeyringMasterKey::new());
            let secrets = Arc::new(Secrets::new(master, db.clone()));

            app.manage(db);
            app.manage(secrets);
            let pty_registry: Arc<Registry> = Arc::new(Registry::new());
            app.manage(pty_registry);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running emdash-dev");
}

/// `EMDASH_DEV_DB_FILE` env var overrides everything (set in dev shells, tests,
/// portable mode). Otherwise the path is `<app_data_dir>/emdash-dev.db`. The
/// app_data_dir on macOS is `~/Library/Application Support/com.emdash.dev/`
/// per the bundle identifier in tauri.conf.json.
fn resolve_db_path(handle: &tauri::AppHandle) -> Result<PathBuf, Box<dyn std::error::Error>> {
    if let Some(explicit) = std::env::var_os("EMDASH_DEV_DB_FILE") {
        let p = PathBuf::from(explicit);
        if p.as_os_str().is_empty() {
            return Err("EMDASH_DEV_DB_FILE is set but empty".into());
        }
        return Ok(p);
    }
    let dir = handle.path().app_data_dir()?;
    Ok(dir.join("emdash-dev.db"))
}
