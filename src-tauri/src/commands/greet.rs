#[tauri::command]
#[specta::specta]
pub fn greet(name: &str) -> String {
    crate::greeting::greet(name)
}
