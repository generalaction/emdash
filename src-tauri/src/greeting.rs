pub fn greet(name: &str) -> String {
    let trimmed = name.trim();
    let who = if trimmed.is_empty() { "world" } else { trimmed };
    format!("Hello, {who}! You've been greeted from emdash-dev (Rust + Tauri 2).")
}
