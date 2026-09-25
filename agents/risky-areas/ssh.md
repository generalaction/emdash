# Risky Area: SSH And Shell Escaping

## Main Files

- `apps/emdash-desktop/src/core/services/ssh/node/` — physical connection generation, credentials,
  stable SSH proxy, configuration resolution, and bounded channel operations
- `apps/emdash-desktop/src/core/services/hosts/node/connection-supervisor.ts` — sole remote
  recovery owner (ADR 0008); SSH and Wire adapters must not add independent reconnect loops
- `src/main/core/fs/impl/ssh-fs.ts`
- `src/main/core/pty/ssh2-pty.ts`
- `src/main/core/terminals/impl/ssh-terminal-provider.ts`
- `src/main/utils/shellEscape.ts`

## Rules

- treat remote shell construction as security-sensitive
- use shared escaping and validation helpers
- do not bypass path-safety or shell validation helpers
- verify how a change affects both connection setup and command execution
- Fence callbacks and late resources by physical generation; preserve logical client identity
  across outages, but never across destination identity edits.
- Do not automatically restart a healthy-but-unresponsive workspace daemon to repair transport;
  sessions and other desktop clients may still depend on it.
- Test and Save share credential-draft resolution. Blank secrets can retain stored credentials
  only for an unchanged destination/account/authentication method (and unchanged key selection
  for passphrases). Changing identity must not silently carry an old secret forward.
- An edit test loads the saved identity in the main process, tests the draft on a separate
  ephemeral connection, and never writes secrets or disconnects the saved connection.
  Stored secrets remain wrapped until SSH connect-config assembly; never send them to the UI.
- Connection saves prepare encrypted credential records before a synchronous SQLite transaction,
  then atomically commit the row, secrets, and identity bindings. Reject a stale row or secret
  snapshot rather than overwriting a concurrent save; never await inside the transaction.
- Credential bindings use the effective destination and, for passphrases, the selected key path
  and content fingerprint. Resolve aliases before credential reuse, including normal reconnects.
  Legacy passwords may be retained for a verified unchanged destination; legacy passphrases
  lack a verifiable key binding and require re-entry once. Keep bindings with the encrypted secret
  so readers cannot mix a credential with another generation's identity.
- An unchanged key with an unbound legacy passphrase must request re-entry before Save, Test,
  or reconnect. A rejected save preserves both the row and secret; never interpret an
  unverified legacy passphrase as absent and silently delete it during a name-only edit.
- Expand user-relative SSH key paths with the OS home-directory helper, not HOME alone;
  Windows environments may provide USERPROFILE without HOME.
