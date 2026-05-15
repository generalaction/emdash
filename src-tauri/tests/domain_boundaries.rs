//! `DOMAIN_MODULES` stay tauri-runtime-free; `TAURI_GLUE_MODULES` are
//! intentionally tauri-aware. New `pub mod` in `lib.rs` without
//! classification fails `all_lib_modules_classified`.

use std::path::{Path, PathBuf};

const DOMAIN_MODULES: &[&str] = &["bindings_parser", "db", "greeting", "pty", "secrets", "shell_env"];
const TAURI_GLUE_MODULES: &[&str] = &["commands", "tauri_bindings"];

#[test]
fn domain_modules_do_not_import_tauri_runtime() {
    let src_dir = src_dir();
    for module in DOMAIN_MODULES {
        for file in module_files(&src_dir, module) {
            let content = read(&file);
            assert_no_tauri_runtime_imports(&file, &content);
        }
    }
}

#[test]
fn all_lib_modules_classified() {
    let lib_rs = read(&src_dir().join("lib.rs"));
    let exported = exported_modules(&lib_rs);
    let unclassified: Vec<&String> = exported
        .iter()
        .filter(|m| {
            !DOMAIN_MODULES.contains(&m.as_str()) && !TAURI_GLUE_MODULES.contains(&m.as_str())
        })
        .collect();
    assert!(
        unclassified.is_empty(),
        "lib.rs exports modules not classified in DOMAIN_MODULES or \
         TAURI_GLUE_MODULES: {unclassified:?} — pick one in \
         tests/domain_boundaries.rs"
    );
}

#[test]
fn classified_modules_are_disjoint_and_complete() {
    let lib_rs = read(&src_dir().join("lib.rs"));
    let exported = exported_modules(&lib_rs);

    for m in DOMAIN_MODULES {
        assert!(
            !TAURI_GLUE_MODULES.contains(m),
            "module `{m}` is in both DOMAIN_MODULES and TAURI_GLUE_MODULES",
        );
    }

    // Catches stale entries left behind after a module is removed.
    for m in DOMAIN_MODULES.iter().chain(TAURI_GLUE_MODULES.iter()) {
        assert!(
            exported.contains(&m.to_string()),
            "module `{m}` is classified but not exported by src/lib.rs",
        );
    }
}

fn src_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src")
}

fn module_files(src_dir: &Path, module: &str) -> Vec<PathBuf> {
    let as_file = src_dir.join(format!("{module}.rs"));
    if as_file.is_file() {
        return vec![as_file];
    }
    let dir = src_dir.join(module);
    if !dir.is_dir() {
        panic!(
            "module `{module}` has neither `{}.rs` nor `{module}/mod.rs`",
            module
        );
    }
    let mut out = Vec::new();
    walk(&dir, &mut out);
    out
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
    for entry in std::fs::read_dir(dir).expect("read_dir") {
        let entry = entry.expect("dir entry");
        let path = entry.path();
        if path.is_dir() {
            walk(&path, out);
        } else if path.extension().and_then(|e| e.to_str()) == Some("rs") {
            out.push(path);
        }
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
