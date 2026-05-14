#[tauri::command]
#[specta::specta]
pub fn greet(name: &str) -> String {
    emdash_dev::greeting::greet(name)
}
