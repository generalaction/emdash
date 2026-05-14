//! Secrets service: composes a MasterKeyProvider, the AEAD primitives, and the
//! write pool to provide `set(key, value)` / `get(key)` round-trips.

use std::sync::Arc;

use thiserror::Error;

use crate::db::{Db, DbError};
use crate::secrets::aead::{self, AeadError};
use crate::secrets::master_key::{MasterKeyError, MasterKeyProvider};

#[derive(Debug, Error)]
pub enum SecretsError {
    #[error("master key access failed: {0}")]
    MasterKey(#[from] MasterKeyError),
    #[error("aead error: {0}")]
    Aead(#[from] AeadError),
    #[error("db error: {0}")]
    Db(#[from] DbError),
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("stored secret has invalid length (nonce={nonce_len}, ciphertext_min=16, got={ciphertext_len})")]
    Malformed { nonce_len: usize, ciphertext_len: usize },
    #[error("stored secret is not valid UTF-8")]
    NotUtf8,
}

pub struct Secrets {
    master: Arc<dyn MasterKeyProvider>,
    db: Arc<Db>,
}

impl Secrets {
    pub fn new(master: Arc<dyn MasterKeyProvider>, db: Arc<Db>) -> Self {
        Self { master, db }
    }

    /// Encrypts `value` under a fresh per-row subkey and upserts the row.
    pub fn set(&self, key: &str, value: &str) -> Result<(), SecretsError> {
        let master = self.master.get_or_create()?;
        let subkey = aead::derive_subkey(&master, key);
        let aad = aead::aad_for(key);
        let sealed = aead::seal(&subkey, value.as_bytes(), &aad)?;

        let conn = self.db.write()?;
        conn.execute(
            "INSERT INTO app_secrets (key, nonce, ciphertext, aad, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) \
             ON CONFLICT(key) DO UPDATE SET \
                 nonce = excluded.nonce, \
                 ciphertext = excluded.ciphertext, \
                 aad = excluded.aad, \
                 updated_at = CURRENT_TIMESTAMP",
            rusqlite::params![key, &sealed.nonce[..], &sealed.ciphertext, &aad],
        )?;
        Ok(())
    }

    pub fn get(&self, key: &str) -> Result<Option<String>, SecretsError> {
        let row = {
            let conn = self.db.read()?;
            let mut stmt = conn.prepare_cached(
                "SELECT nonce, ciphertext, aad FROM app_secrets WHERE key = ?1",
            )?;
            stmt.query_row(rusqlite::params![key], |r| {
                Ok((
                    r.get::<_, Vec<u8>>(0)?,
                    r.get::<_, Vec<u8>>(1)?,
                    r.get::<_, Vec<u8>>(2)?,
                ))
            })
            .map(Some)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                other => Err(other),
            })?
        };

        let Some((nonce, ciphertext, aad)) = row else {
            return Ok(None);
        };

        let nonce_arr: [u8; 12] = nonce.as_slice().try_into().map_err(|_| {
            SecretsError::Malformed {
                nonce_len: nonce.len(),
                ciphertext_len: ciphertext.len(),
            }
        })?;

        let master = self.master.get_or_create()?;
        let subkey = aead::derive_subkey(&master, key);
        let plaintext = aead::open(&subkey, &ciphertext, &nonce_arr, &aad)?;
        let s = String::from_utf8(plaintext).map_err(|_| SecretsError::NotUtf8)?;
        Ok(Some(s))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;
    use crate::secrets::master_key::InMemoryMasterKey;
    use tempfile::TempDir;

    fn build() -> (TempDir, Secrets) {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().join("t.db")).unwrap();
        let master = Arc::new(InMemoryMasterKey::default());
        (dir, Secrets::new(master, db))
    }

    #[test]
    fn get_returns_none_for_missing_key() {
        let (_d, s) = build();
        assert!(s.get("missing").unwrap().is_none());
    }

    #[test]
    fn set_then_get_roundtrips() {
        let (_d, s) = build();
        s.set("github_token", "ghp_abc123").unwrap();
        assert_eq!(s.get("github_token").unwrap().as_deref(), Some("ghp_abc123"));
    }

    #[test]
    fn set_overwrites_existing_value() {
        let (_d, s) = build();
        s.set("k", "v1").unwrap();
        s.set("k", "v2").unwrap();
        assert_eq!(s.get("k").unwrap().as_deref(), Some("v2"));
    }

    #[test]
    fn empty_string_value_is_supported() {
        let (_d, s) = build();
        s.set("k", "").unwrap();
        assert_eq!(s.get("k").unwrap().as_deref(), Some(""));
    }

    #[test]
    fn each_set_uses_a_fresh_nonce() {
        // Same key + same value should still produce different ciphertexts
        // in the row each time set() is called.
        let (_d, s) = build();
        s.set("k", "v").unwrap();
        let (nonce1, ct1) = read_raw(&s, "k");
        s.set("k", "v").unwrap();
        let (nonce2, ct2) = read_raw(&s, "k");
        assert_ne!(nonce1, nonce2, "nonce must rotate on each write");
        assert_ne!(ct1, ct2, "ciphertext must differ when nonce rotates");
    }

    #[test]
    fn tampered_row_fails_to_decrypt() {
        let (_d, s) = build();
        s.set("k", "v").unwrap();
        {
            let conn = s.db.write().unwrap();
            conn.execute(
                "UPDATE app_secrets SET ciphertext = ? WHERE key = 'k'",
                rusqlite::params![&[0u8; 32][..]],
            )
            .unwrap();
        }
        let result = s.get("k");
        assert!(
            matches!(result, Err(SecretsError::Aead(_))),
            "tampered ciphertext must surface as an Aead error, got {result:?}"
        );
    }

    fn read_raw(s: &Secrets, key: &str) -> (Vec<u8>, Vec<u8>) {
        let conn = s.db.read().unwrap();
        conn.query_row(
            "SELECT nonce, ciphertext FROM app_secrets WHERE key = ?",
            rusqlite::params![key],
            |r| Ok((r.get::<_, Vec<u8>>(0)?, r.get::<_, Vec<u8>>(1)?)),
        )
        .unwrap()
    }
}
