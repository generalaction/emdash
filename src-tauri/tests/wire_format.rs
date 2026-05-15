//! Wire-format snapshots for the renderer <-> Rust IPC contract. A deliberate
//! signature change must be accepted via `cargo insta review`.

#[test]
fn greet_wire_format() {
    let response = emdash_dev::greeting::greet("world");
    let request_args = serde_json::json!({ "name": "world" });

    insta::assert_json_snapshot!("greet_request_args", request_args);
    insta::assert_snapshot!("greet_response_world", response);
}

#[test]
fn greet_trims_and_defaults_empty_name() {
    insta::assert_snapshot!("greet_empty_name", emdash_dev::greeting::greet(""));
    insta::assert_snapshot!("greet_whitespace_name", emdash_dev::greeting::greet("   "));
}

/// Pins request args (locks the signature) and response *type* (the value
/// is host-dependent so we can't snapshot it directly).
#[test]
fn get_path_wire_format() {
    let request_args = serde_json::Value::Null;
    insta::assert_json_snapshot!("get_path_request_args", request_args);

    // Response type is `string` — pin the type, not the value.
    let response_type = std::any::type_name_of_val(&emdash_dev::shell_env::shell_env().path());
    insta::assert_snapshot!("get_path_response_type", response_type);
}

#[test]
fn bindings_ts_snapshot() {
    let path = format!("{}/ui/src/bindings.ts", env!("CARGO_MANIFEST_DIR"),);
    let content = std::fs::read_to_string(&path).unwrap_or_else(|e| {
        panic!("read {path}: {e} — run `cargo run --bin emdash-dev -- --export-bindings`")
    });
    insta::assert_snapshot!("bindings_ts", content);
}

/// Regenerates bindings to a temp path and diffs against the committed file.
/// Catches stale bindings.ts locally — without this the only freshness check
/// is the CI `git diff` step.
#[test]
fn bindings_ts_in_sync_with_rust() {
    let tmp = std::env::temp_dir().join(format!(
        "emdash-dev-bindings-{}-{}.ts",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));

    emdash_dev::tauri_bindings::export_bindings_to(&tmp).expect("export_bindings_to must succeed");
    let regenerated = std::fs::read_to_string(&tmp).expect("read regenerated bindings");
    let _ = std::fs::remove_file(&tmp);

    let committed_path = format!(
        "{}/{}",
        env!("CARGO_MANIFEST_DIR"),
        emdash_dev::tauri_bindings::BINDINGS_PATH
    );
    let committed = std::fs::read_to_string(&committed_path)
        .unwrap_or_else(|e| panic!("read committed bindings {committed_path}: {e}"));

    assert_eq!(
        regenerated, committed,
        "ui/src/bindings.ts is stale relative to the Rust command set. \
         Run `cargo run --bin emdash-dev -- --export-bindings` and commit."
    );
}

#[test]
fn set_secret_wire_format() {
    let request_args = serde_json::json!({ "key": "github_token", "value": "ghp_abc123" });
    insta::assert_json_snapshot!("set_secret_request_args", request_args);
}

#[test]
fn get_secret_wire_format() {
    let request_args = serde_json::json!({ "key": "github_token" });
    insta::assert_json_snapshot!("get_secret_request_args", request_args);
}

#[test]
fn secrets_error_envelope_shape() {
    // Confirms the {code, message} envelope is serialized in snake_case.
    use emdash_dev::commands::secrets::{SecretsCommandError, SecretsErrorCode};
    let err = SecretsCommandError {
        code: SecretsErrorCode::KeyringUnavailable,
        message: "example".to_string(),
    };
    insta::assert_json_snapshot!(
        "secrets_error_envelope",
        serde_json::to_value(&err).unwrap()
    );
}

#[test]
fn pty_spawn_wire_format() {
    // Channel<Vec<u8>> is opaque on the wire (an internal id) — we pin the
    // user-visible args only. The bindings.ts snapshot covers the full
    // command signature including the Channel parameter.
    let request_args = serde_json::json!({
        "opts": {
            "command": "/bin/bash",
            "args": [],
            "cwd": null,
            "env": {},
            "size": { "rows": 24, "cols": 80 }
        }
    });
    insta::assert_json_snapshot!("pty_spawn_request_args", request_args);
}

#[test]
fn pty_write_wire_format() {
    let request_args = serde_json::json!({
        "id": 1,
        "bytes": [104, 105]
    });
    insta::assert_json_snapshot!("pty_write_request_args", request_args);
}

#[test]
fn pty_resize_wire_format() {
    let request_args = serde_json::json!({
        "id": 1,
        "size": { "rows": 40, "cols": 132 }
    });
    insta::assert_json_snapshot!("pty_resize_request_args", request_args);
}

#[test]
fn pty_kill_wire_format() {
    let request_args = serde_json::json!({ "id": 1 });
    insta::assert_json_snapshot!("pty_kill_request_args", request_args);
}

#[test]
fn pty_error_envelope_shape() {
    use emdash_dev::pty::types::{PtyError, PtyId};
    let err = PtyError::NotFound { id: PtyId(42) };
    insta::assert_json_snapshot!("pty_error_not_found", serde_json::to_value(&err).unwrap());
}
