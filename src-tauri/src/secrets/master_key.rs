//! Master key storage. OS keychain in production, in-memory in tests. The trait
//! exists so `Secrets` consumers never see `keyring::*` directly — that crate's
//! errors leak across platforms in ways the domain shouldn't surface.

use std::sync::Mutex;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum MasterKeyError {
    #[error(
        "OS keychain is unavailable. \
         On Linux, install a Secret Service implementation (e.g. `gnome-keyring` \
         or `kwallet`) and ensure D-Bus is reachable. \
         Underlying error: {0}"
    )]
    KeyringUnavailable(String),
    #[error("OS keychain returned a malformed value: {0}")]
    Malformed(String),
    #[error("internal random generator failed: {0}")]
    Random(String),
}

pub trait MasterKeyProvider: Send + Sync {
    /// Returns the master key, creating and persisting one on first call.
    fn get_or_create(&self) -> Result<[u8; 32], MasterKeyError>;
}

/// Production impl: keys live in the user's OS keychain under
/// `service = SERVICE`, `account = ACCOUNT`. Pinned to a v1 account name so
/// future rotation schemes can introduce v2 alongside.
pub struct OsKeyringMasterKey {
    service: String,
    account: String,
}

impl OsKeyringMasterKey {
    pub const DEFAULT_SERVICE: &'static str = "sh.emdash.emdash-dev";
    pub const DEFAULT_ACCOUNT: &'static str = "master-key-v1";

    pub fn new() -> Self {
        Self {
            service: Self::DEFAULT_SERVICE.to_string(),
            account: Self::DEFAULT_ACCOUNT.to_string(),
        }
    }
}

impl Default for OsKeyringMasterKey {
    fn default() -> Self {
        Self::new()
    }
}

impl MasterKeyProvider for OsKeyringMasterKey {
    fn get_or_create(&self) -> Result<[u8; 32], MasterKeyError> {
        use base64::Engine as _;

        let entry = keyring::Entry::new(&self.service, &self.account)
            .map_err(|e| MasterKeyError::KeyringUnavailable(e.to_string()))?;

        match entry.get_password() {
            Ok(stored) => decode_master_key(&stored),
            Err(keyring::Error::NoEntry) => {
                let mut key = [0u8; 32];
                rand::RngCore::try_fill_bytes(&mut rand::thread_rng(), &mut key)
                    .map_err(|e| MasterKeyError::Random(e.to_string()))?;
                let encoded = base64::engine::general_purpose::STANDARD.encode(key);
                entry
                    .set_password(&encoded)
                    .map_err(|e| MasterKeyError::KeyringUnavailable(e.to_string()))?;
                Ok(key)
            }
            Err(e) => Err(MasterKeyError::KeyringUnavailable(e.to_string())),
        }
    }
}

fn decode_master_key(stored: &str) -> Result<[u8; 32], MasterKeyError> {
    use base64::Engine as _;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(stored)
        .map_err(|e| MasterKeyError::Malformed(format!("base64 decode: {e}")))?;
    let array: [u8; 32] = bytes
        .as_slice()
        .try_into()
        .map_err(|_| MasterKeyError::Malformed(format!("expected 32 bytes, got {}", bytes.len())))?;
    Ok(array)
}

/// In-memory provider used by tests and integration suites. Not exposed to
/// production code paths.
pub struct InMemoryMasterKey {
    key: Mutex<Option<[u8; 32]>>,
}

impl Default for InMemoryMasterKey {
    fn default() -> Self {
        Self {
            key: Mutex::new(None),
        }
    }
}

impl InMemoryMasterKey {
    pub fn with_key(key: [u8; 32]) -> Self {
        Self {
            key: Mutex::new(Some(key)),
        }
    }
}

impl MasterKeyProvider for InMemoryMasterKey {
    fn get_or_create(&self) -> Result<[u8; 32], MasterKeyError> {
        let mut guard = self.key.lock().expect("InMemoryMasterKey mutex poisoned");
        if let Some(k) = *guard {
            return Ok(k);
        }
        let mut k = [0u8; 32];
        rand::RngCore::try_fill_bytes(&mut rand::thread_rng(), &mut k)
            .map_err(|e| MasterKeyError::Random(e.to_string()))?;
        *guard = Some(k);
        Ok(k)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn in_memory_creates_and_persists_one_key() {
        let p = InMemoryMasterKey::default();
        let k1 = p.get_or_create().unwrap();
        let k2 = p.get_or_create().unwrap();
        assert_eq!(k1, k2, "subsequent calls must return the same key");
    }

    #[test]
    fn in_memory_creates_different_keys_across_providers() {
        let a = InMemoryMasterKey::default().get_or_create().unwrap();
        let b = InMemoryMasterKey::default().get_or_create().unwrap();
        assert_ne!(a, b, "each fresh provider generates a fresh key");
    }

    #[test]
    fn in_memory_preset_uses_provided_key() {
        let preset = [42u8; 32];
        let p = InMemoryMasterKey::with_key(preset);
        assert_eq!(p.get_or_create().unwrap(), preset);
    }
}
