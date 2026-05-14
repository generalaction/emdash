//! ChaCha20-Poly1305 AEAD + HKDF-SHA256 subkey derivation. No I/O, no Tauri.

use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    ChaCha20Poly1305, Nonce,
};
use hkdf::Hkdf;
use rand::RngCore;
use sha2::Sha256;
use thiserror::Error;
use zeroize::Zeroize;

/// AAD prefix. Bumping the version invalidates every stored row — used here so
/// future schemes (e.g., XChaCha or key rotation) can change the binding without
/// guessing.
const AAD_PREFIX: &[u8] = b"emdash-dev/secrets/v1/";

#[derive(Debug, Error)]
pub enum AeadError {
    #[error("AEAD authentication failed (tampered ciphertext, wrong key, or wrong aad)")]
    Authentication,
}

pub struct Sealed {
    pub nonce: [u8; 12],
    pub ciphertext: Vec<u8>,
}

/// HKDF-SHA256 over (master, info = AAD_PREFIX || key_name) → 32-byte subkey.
pub fn derive_subkey(master: &[u8; 32], key_name: &str) -> [u8; 32] {
    let hk = Hkdf::<Sha256>::new(None, master);
    let mut info = Vec::with_capacity(AAD_PREFIX.len() + key_name.len());
    info.extend_from_slice(AAD_PREFIX);
    info.extend_from_slice(key_name.as_bytes());

    let mut out = [0u8; 32];
    hk.expand(&info, &mut out)
        .expect("32 bytes is well below HKDF-SHA256 max output (8160 bytes)");
    out
}

/// AAD bound to a specific key name. Stored in the row alongside the ciphertext
/// so future audits don't have to re-derive from the key name.
pub fn aad_for(key_name: &str) -> Vec<u8> {
    let mut v = Vec::with_capacity(AAD_PREFIX.len() + key_name.len());
    v.extend_from_slice(AAD_PREFIX);
    v.extend_from_slice(key_name.as_bytes());
    v
}

pub fn seal(subkey: &[u8; 32], plaintext: &[u8], aad: &[u8]) -> Result<Sealed, AeadError> {
    let cipher = ChaCha20Poly1305::new(subkey.into());

    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, Payload { msg: plaintext, aad })
        .map_err(|_| AeadError::Authentication)?;

    Ok(Sealed {
        nonce: nonce_bytes,
        ciphertext,
    })
}

pub fn open(
    subkey: &[u8; 32],
    ciphertext: &[u8],
    nonce: &[u8; 12],
    aad: &[u8],
) -> Result<Vec<u8>, AeadError> {
    let cipher = ChaCha20Poly1305::new(subkey.into());
    let nonce = Nonce::from_slice(nonce);
    cipher
        .decrypt(nonce, Payload { msg: ciphertext, aad })
        .map_err(|_| AeadError::Authentication)
}

/// Helper to scrub a 32-byte buffer in place — call after the subkey leaves scope
/// where you want to be defensive. Not load-bearing for correctness.
pub fn zeroize_subkey(k: &mut [u8; 32]) {
    k.zeroize();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn master() -> [u8; 32] {
        let mut k = [0u8; 32];
        for (i, b) in k.iter_mut().enumerate() {
            *b = i as u8;
        }
        k
    }

    #[test]
    fn subkey_is_deterministic_per_key_name() {
        let m = master();
        let a1 = derive_subkey(&m, "github_token");
        let a2 = derive_subkey(&m, "github_token");
        let b = derive_subkey(&m, "openai_token");
        assert_eq!(a1, a2, "same key name must derive the same subkey");
        assert_ne!(a1, b, "different key names must derive different subkeys");
    }

    #[test]
    fn subkey_changes_with_master_key() {
        let m1 = master();
        let mut m2 = m1;
        m2[0] ^= 0xff;
        assert_ne!(
            derive_subkey(&m1, "token"),
            derive_subkey(&m2, "token"),
            "different masters must yield different subkeys"
        );
    }

    #[test]
    fn aad_binds_to_key_name() {
        assert_ne!(aad_for("a"), aad_for("b"));
        assert_eq!(aad_for("a"), aad_for("a"));
        assert!(
            aad_for("github_token").starts_with(b"emdash-dev/secrets/v1/"),
            "aad must be versioned so future schemes can rotate cleanly"
        );
    }

    #[test]
    fn seal_open_roundtrip() {
        let key = derive_subkey(&master(), "k");
        let aad = aad_for("k");
        let plaintext = b"super secret token value";

        let sealed = seal(&key, plaintext, &aad).expect("seal");
        let recovered = open(&key, &sealed.ciphertext, &sealed.nonce, &aad).expect("open");
        assert_eq!(recovered, plaintext);
    }

    #[test]
    fn seal_uses_fresh_nonce() {
        let key = derive_subkey(&master(), "k");
        let aad = aad_for("k");
        let s1 = seal(&key, b"same plaintext", &aad).unwrap();
        let s2 = seal(&key, b"same plaintext", &aad).unwrap();
        assert_ne!(s1.nonce, s2.nonce, "nonces must be fresh per write");
        assert_ne!(
            s1.ciphertext, s2.ciphertext,
            "same plaintext under fresh nonces must produce different ciphertexts"
        );
    }

    #[test]
    fn open_rejects_tampered_ciphertext() {
        let key = derive_subkey(&master(), "k");
        let aad = aad_for("k");
        let sealed = seal(&key, b"hello", &aad).unwrap();

        let mut tampered = sealed.ciphertext.clone();
        tampered[0] ^= 0x01;
        assert!(
            open(&key, &tampered, &sealed.nonce, &aad).is_err(),
            "modified ciphertext must fail to open"
        );
    }

    #[test]
    fn open_rejects_wrong_aad() {
        let key = derive_subkey(&master(), "k");
        let sealed = seal(&key, b"hello", &aad_for("k")).unwrap();
        assert!(
            open(&key, &sealed.ciphertext, &sealed.nonce, &aad_for("other")).is_err(),
            "aad mismatch must fail to open — this is how key_name is bound"
        );
    }

    #[test]
    fn open_rejects_wrong_nonce() {
        let key = derive_subkey(&master(), "k");
        let aad = aad_for("k");
        let sealed = seal(&key, b"hello", &aad).unwrap();
        let mut wrong_nonce = sealed.nonce;
        wrong_nonce[0] ^= 0xff;
        assert!(open(&key, &sealed.ciphertext, &wrong_nonce, &aad).is_err());
    }
}
