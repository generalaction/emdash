# ADR-0002: DB + secrets foundation (rusqlite + keyring + AEAD)

## Status

Accepted

## Context

EMD-6 stands up the data layer for emdash-dev: schema storage and a secrets
store. Several design forks were taken whose rationale should not have to be
reconstructed from `Cargo.toml`, the migration SQL, or the keyring crate's
release notes.

## Decision

### 1. Two pools (read=8, write=1), no SQL-level queue

`Db` owns a read pool (size 8) and a write pool (size 1) over the same file.
WAL mode lets readers run concurrently with the single writer. Eliminating
`SQLITE_BUSY` at the app layer falls out of the pool topology — no async
queue, no busy-handler tuning, no retry loop.

Read connections additionally have `PRAGMA query_only = ON`, so a write
attempted through `ReadConn` fails at the SQLite engine level — converting
the two-pool safety from convention to a load-bearing invariant.

Trade-off: every call site picks a pool explicitly. A read that uses the
write pool blocks every other writer; a write that uses the read pool is
now rejected (rather than silently breaking the contract). `Db::read()` and
`Db::write()` return `ReadConn` / `WriteConn` newtypes so the choice is
visible in code review.

### 2. Collapsed bootstrap migration — Drizzle history is not preserved

The Electron emdash schema took 12 Drizzle migrations to evolve. The Tauri
rewrite ships **one** `rusqlite_migration::M` that produces the final-state
schema directly. Justification: the rewrite is fresh-install-only (umbrella
decision #3), so no existing user database will ever open in emdash-dev.

`app_secrets` is the one table where the collapsed schema **diverges** from
the Electron final state: EMD-6 uses an AEAD layout (`key`, `nonce`,
`ciphertext`, `aad`, `created_at`, `updated_at`) where the Electron table
held plaintext. The Electron table was never actually used as a persistent
token store; this divergence is the EMD-6-defined final state, not a
regression.

If the fresh-install-only decision is ever reversed, this collapse must be
unwound and a series of forward migrations reconstructed from the Drizzle
files in `drizzle/`.

### 3. PRAGMA values matched to better-sqlite3 defaults

```
journal_mode = WAL
synchronous = NORMAL
foreign_keys = ON
mmap_size = 268435456     (256 MiB)
cache_size = -64000       (64 MiB, negative = KiB)
query_only = ON           (read pool only)
```

`journal_mode` and `synchronous` are DB-wide and applied once at creation;
the rest are per-connection and applied on every pool acquisition through
`r2d2::CustomizeConnection`. Matching better-sqlite3's defaults means an
emdash-dev install behaves like an emdash install in terms of fsync cadence
and memory footprint — easier comparison during the rewrite.

### 4. Master key in OS keychain; per-secret AEAD over rows

The master key is a 32-byte random value generated on first run and stored
in the OS keychain under `service = sh.emdash.emdash-dev`,
`account = master-key-v1`. The `-v1` suffix reserves room for future
rotation.

For each secret, a per-row **subkey** is derived via HKDF-SHA256 with
`info = b"emdash-dev/secrets/v1/" || key_name`. The plaintext is then
encrypted under ChaCha20-Poly1305 with a fresh 12-byte nonce and the same
versioned prefix as AAD. The AAD is also stored in the row so future audits
can read it without re-deriving from the key name.

Why HKDF + per-row subkey instead of using the master directly:

- Compromise of one subkey doesn't reveal the master.
- The version tag in HKDF info lets us roll the scheme (e.g. XChaCha,
  Argon2-derived master) without re-encrypting in place — write a v2 row
  alongside v1 and migrate lazily.
- HKDF is essentially free in CPU terms; the extra step has no cost.

Why ChaCha20-Poly1305 specifically:

- Constant-time on all platforms we ship (no AES-NI requirement).
- 12-byte nonce + 16-byte tag fits comfortably in a SQLite BLOB column.
- The `chacha20poly1305` crate is widely deployed and audited.

### 5. `MasterKeyProvider` trait — keyring lives behind an abstraction

Tests cannot use the real OS keychain (CI on headless Linux has no
Secret Service; macOS CI keychains are unlocked in non-default ways). The
`MasterKeyProvider` trait isolates the keyring path so:

- Production: `OsKeyringMasterKey` (the only consumer of the `keyring`
  crate).
- Tests: `InMemoryMasterKey` (deterministic when seeded, fresh-random
  otherwise).

The `OsKeyringMasterKey` impl maps Linux-secret-service-missing errors to a
structured `MasterKeyError::KeyringUnavailable { remediation }` so the
renderer can surface an actionable hint ("install gnome-keyring or kwallet")
instead of an opaque platform error.

### 6. Token storage policy

All provider tokens (issue #8 codex, issue #9 Claude, future v1.x
providers) **must** go through `crate::secrets::Secrets`. Plaintext tokens
in any column of `app_settings`, `kv`, or a provider-specific table are a
review-blocker, even temporarily. This rule is what keeps the AEAD layer
load-bearing instead of decorative.

### 7. Why not `tauri-plugin-sql` or `tauri-plugin-stronghold`

- `tauri-plugin-sql` exposes a SQL surface to the renderer. The emdash
  architecture wants all DB code in Rust and only typed commands across
  IPC. Adopting the plugin would force a parallel SQL contract.
- `tauri-plugin-stronghold` is a heavier, more general-purpose secret
  store with its own snapshot format and password-protection ceremony. For
  our use case (single 32-byte master, OS-managed unlock), the keyring +
  AEAD combination is simpler and easier to audit.

## Consequences

**Easier:**

- Subsequent provider integrations (codex, Claude) inherit a vetted secret
  store and don't re-invent it.
- The two-pool model gives us a `SQLITE_BUSY`-free baseline; load tests
  measure logical contention, not pool wait time.
- The collapsed migration means a fresh install runs one SQL statement on
  first launch, not 12.

**Harder:**

- Reversing the fresh-install-only decision requires reconstructing forward
  migrations from `drizzle/` — bounded but real work.
- Every call site has to pick `read()` vs `write()` correctly; `query_only`
  surfaces wrong-pool writes as errors rather than silent contract breaks.
- Linux installs without a Secret Service implementation surface a
  structured error instead of silently falling back. We accept this as the
  cost of not having a hidden insecure path.

**Triggers to revisit:**

- A second OS keychain implementation (e.g., Apple Secure Enclave) is
  worth wrapping in a v2 master-key scheme.
- Token volume grows past ~100 rows or AEAD overhead shows in profiling
  (very unlikely at our scale, but track it).
- Any provider needs more than `string` values (e.g., refresh-token
  bundles) — extend the value type rather than smuggling JSON through the
  string column.
