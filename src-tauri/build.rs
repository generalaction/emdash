// Build-time invariants for the emdash-dev crate.
//
// 1. Standard Tauri 2 codegen via `tauri_build::build()`.
// 2. Custom capability-allowlist check: every command emitted into the
//    generated `ui/src/bindings.ts` (i.e. every entry in `collect_commands!`)
//    must appear in `allowed-commands.json`, and vice versa.
//    Drift fails the build, forcing intentional review when a command is
//    added or removed.

use std::path::PathBuf;

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
    let in_bindings = extract_invoke_channels(&bindings);

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

fn extract_invoke_channels(bindings: &str) -> Vec<String> {
    // Looks for `__TAURI_INVOKE<...>("channel-name", ...)` and pulls the
    // channel name. Matches the format tauri-specta currently emits — if
    // they change the codegen template, this parser must follow.
    let mut out = Vec::new();
    for line in bindings.lines() {
        let Some(start) = line.find("__TAURI_INVOKE<") else {
            continue;
        };
        let rest = &line[start..];
        let Some(paren) = rest.find("(\"") else {
            continue;
        };
        let after_quote = &rest[paren + 2..];
        let Some(end) = after_quote.find('"') else {
            continue;
        };
        out.push(after_quote[..end].to_string());
    }
    out
}

fn env_var(name: &str) -> Result<String, String> {
    std::env::var(name).map_err(|e| format!("env {name}: {e}"))
}
