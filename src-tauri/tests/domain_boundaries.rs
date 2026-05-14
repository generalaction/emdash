use std::path::{Path, PathBuf};

#[test]
fn lib_exported_modules_do_not_import_tauri_runtime() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let src_dir = manifest_dir.join("src");
    let lib_rs = read(&src_dir.join("lib.rs"));

    assert_no_tauri_runtime_imports(&src_dir.join("lib.rs"), &lib_rs);

    for module in exported_modules(&lib_rs) {
        let module_path = src_dir.join(format!("{module}.rs"));
        let content = read(&module_path);
        assert_no_tauri_runtime_imports(&module_path, &content);
    }
}

fn exported_modules(lib_rs: &str) -> Vec<String> {
    lib_rs
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            let rest = trimmed.strip_prefix("pub mod ")?;
            Some(rest.trim_end_matches(';').trim().to_string())
        })
        .collect()
}

fn assert_no_tauri_runtime_imports(path: &Path, content: &str) {
    for forbidden in [
        "#[tauri::command]",
        "tauri::AppHandle",
        "tauri::Window",
        "tauri::Webview",
        "use tauri",
    ] {
        assert!(
            !content.contains(forbidden),
            "{} must stay Tauri-runtime-free; found `{forbidden}`",
            path.display()
        );
    }
}

fn read(path: &Path) -> String {
    std::fs::read_to_string(path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()))
}
