/// Login-shell `$PATH` captured at app startup. OnceLock-cached.
#[tauri::command]
#[specta::specta]
pub fn get_path() -> String {
    crate::shell_env::shell_env().path()
}
