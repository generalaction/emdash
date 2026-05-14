//! Tauri runtime glue. Domain logic stays in `emdash_dev::*` lib modules.

use emdash_dev::tauri_bindings;

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
        .setup(move |app| {
            specta_builder.mount_events(app);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running emdash-dev");
}
