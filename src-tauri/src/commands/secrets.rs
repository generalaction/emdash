//! Tauri command glue for the secrets store. Domain logic lives in
//! `crate::secrets`; this file only translates `tauri::State` + argument types
//! into domain calls and maps errors to a serializable envelope.

use std::sync::Arc;

use serde::Serialize;
use specta::Type;

use crate::secrets::{Secrets, SecretsError};

#[derive(Debug, Serialize, Type)]
pub struct SecretsCommandError {
    /// Stable machine-readable identifier. Renderer matches on this.
    pub code: SecretsErrorCode,
    /// Human-readable hint. Surface this to the user verbatim.
    pub message: String,
}

#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum SecretsErrorCode {
    KeyringUnavailable,
    Crypto,
    Storage,
    InvalidValue,
    Unknown,
}

impl From<SecretsError> for SecretsCommandError {
    fn from(e: SecretsError) -> Self {
        let message = e.to_string();
        let code = match e {
            SecretsError::MasterKey(_) => SecretsErrorCode::KeyringUnavailable,
            SecretsError::Aead(_) => SecretsErrorCode::Crypto,
            SecretsError::Db(_) | SecretsError::Sqlite(_) | SecretsError::Malformed { .. } => {
                SecretsErrorCode::Storage
            }
            SecretsError::NotUtf8 => SecretsErrorCode::InvalidValue,
        };
        Self { code, message }
    }
}

#[tauri::command]
#[specta::specta]
pub fn set_secret(
    state: tauri::State<'_, Arc<Secrets>>,
    key: String,
    value: String,
) -> Result<(), SecretsCommandError> {
    state.set(&key, &value).map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub fn get_secret(
    state: tauri::State<'_, Arc<Secrets>>,
    key: String,
) -> Result<Option<String>, SecretsCommandError> {
    state.get(&key).map_err(Into::into)
}
