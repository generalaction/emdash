// 1. Tauri 2 codegen.
// 2. Capability-allowlist drift check (bindings.ts <-> allowed-commands.json).

use std::path::PathBuf;

// Share the parser between build.rs and the lib via #[path]; tests in
// `pub mod bindings_parser` (lib.rs) cover the same source.
#[path = "src/bindings_parser.rs"]
mod bindings_parser;

fn main() {
    tauri_build::build();
    if let Err(err) = check_capability_allowlist() {
        panic!("\n\nemdash-dev capability allowlist check failed:\n\n{err}\n");
    }
}

fn check_capability_allowlist() -> Result<(), String> {
    let manifest_dir = PathBuf::from(env_var("CARGO_MANIFEST_DIR")?);
    let allowlist_path = manifest_dir.join("allowed-commands.json");
    let bindings_path = manifest_dir.join("ui/src/bindings.ts");

    println!("cargo:rerun-if-changed={}", allowlist_path.display());
    println!("cargo:rerun-if-changed={}", bindings_path.display());

    let allowlist_raw = std::fs::read_to_string(&allowlist_path)
        .map_err(|e| format!("  read {}: {e}", allowlist_path.display()))?;
    let parsed: serde_json::Value = serde_json::from_str(&allowlist_raw)
        .map_err(|e| format!("  parse {}: {e}", allowlist_path.display()))?;
    let allowlist: Vec<String> = parsed
        .get("commands")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "  allowlist JSON missing `commands` array".to_string())?
        .iter()
        .filter_map(|v| v.as_str().map(str::to_string))
        .collect();

    let bindings = std::fs::read_to_string(&bindings_path)
        .map_err(|e| format!("  read {}: {e}", bindings_path.display()))?;
    let in_bindings = bindings_parser::extract_invoke_channels(&bindings);

    let invalid_shapes: Vec<&String> = allowlist.iter().filter(|c| !is_valid_channel(c)).collect();
    if !invalid_shapes.is_empty() {
        return Err(format!(
            "  - allowed-commands.json contains entries that don't match ^[a-z][a-z0-9_]*$: {invalid_shapes:?}\n    these are typically typos (e.g., trailing whitespace) — fix the JSON\n"
        ));
    }

    let missing: Vec<&String> = in_bindings
        .iter()
        .filter(|c| !allowlist.contains(c))
        .collect();
    let unused: Vec<&String> = allowlist
        .iter()
        .filter(|c| !in_bindings.contains(c))
        .collect();

    if !missing.is_empty() || !unused.is_empty() {
        let mut msg = String::new();
        if !missing.is_empty() {
            msg.push_str(&format!(
                "  - commands present in bindings.ts but not in allowed-commands.json: {missing:?}\n    add them to src-tauri/allowed-commands.json\n"
            ));
        }
        if !unused.is_empty() {
            msg.push_str(&format!(
                "  - commands present in allowed-commands.json but not in bindings.ts: {unused:?}\n    remove them from src-tauri/allowed-commands.json, or add to collect_commands! in app.rs and re-run `cargo run --bin emdash-dev -- --export-bindings`\n"
            ));
        }
        return Err(msg);
    }

    Ok(())
}

fn is_valid_channel(name: &str) -> bool {
    let mut chars = name.chars();
    match chars.next() {
        Some(c) if c.is_ascii_lowercase() => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

fn env_var(name: &str) -> Result<String, String> {
    std::env::var(name).map_err(|e| format!("env {name}: {e}"))
}
