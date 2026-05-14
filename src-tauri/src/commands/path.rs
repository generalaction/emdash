/// Returns the `$PATH` captured from the user's login shell at app startup.
/// Backed by `shell_env::shell_env()` (OnceLock-cached), so this command is
/// cheap to call repeatedly. See `src-tauri/src/shell_env.rs`.
#[tauri::command]
#[specta::specta]
pub fn get_path() -> String {
    emdash_dev::shell_env::shell_env().path()
}
