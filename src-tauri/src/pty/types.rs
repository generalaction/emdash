//! PTY data types — wire-visible via specta.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(transparent)]
pub struct PtyId(pub u64);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct PtySize {
    pub rows: u16,
    pub cols: u16,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct SpawnOptions {
    pub command: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub env: HashMap<String, String>,
    pub size: PtySize,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PtyError {
    NotFound { id: PtyId },
    SpawnFailed { message: String },
    Io { message: String },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pty_id_serializes_transparently() {
        let id = PtyId(42);
        let json = serde_json::to_string(&id).unwrap();
        assert_eq!(json, "42", "PtyId must serialize as a bare number");
    }

    #[test]
    fn pty_error_uses_kind_tag() {
        let err = PtyError::NotFound { id: PtyId(7) };
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["kind"], "not_found");
        assert_eq!(json["id"], 7);
    }

    #[test]
    fn spawn_options_round_trip() {
        let opts = SpawnOptions {
            command: "/bin/echo".into(),
            args: vec!["hi".into()],
            cwd: Some("/tmp".into()),
            env: HashMap::from([("FOO".to_string(), "bar".to_string())]),
            size: PtySize { rows: 24, cols: 80 },
        };
        let json = serde_json::to_string(&opts).unwrap();
        let back: SpawnOptions = serde_json::from_str(&json).unwrap();
        assert_eq!(back.command, opts.command);
        assert_eq!(back.args, opts.args);
        assert_eq!(back.cwd, opts.cwd);
        assert_eq!(back.env, opts.env);
        assert_eq!(back.size, opts.size);
    }
}
