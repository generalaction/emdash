# Risky Area: SSH And Shell Escaping

## Main Files

- `apps/emdash-desktop/src/core/services/ssh/node/` — physical connection generation, credentials,
  stable SSH proxy, configuration resolution, and bounded subprocess operations
- `apps/emdash-desktop/src/core/services/hosts/node/connection-supervisor.ts` — sole remote
  recovery owner (ADR 0008); SSH and Wire adapters must not add independent reconnect loops
- `apps/emdash-desktop/src/core/services/ssh/node/openssh/` — process ownership, native sessions,
  and the temporary askpass credential broker
- `apps/emdash-desktop/src/core/services/hosts/node/workspace-server/connect/stdio-relay.ts` —
  attaches to the existing daemon using its bundled Node runtime
- `apps/emdash-desktop/src/core/features/preview-servers/node/port-forward-tunnel.ts` — preview
  listener and traffic observation, using an opaque SSH forward
- `packages/core/src/primitives/exec/` — command arguments and shell escaping

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
  Stored secrets remain wrapped until a matching askpass request; never send them to the UI.
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

## OpenSSH Boundaries

`SshClientProxy` is the stable application API: execute a command, open a binary command stream,
create a local-only forward. It exposes no subprocess, library client, or control socket.
`SshConnectionManager` owns physical generations and fences late completions. `openssh/session.ts`
composes the native processes for one generation; `openssh/process.ts` owns spawning, process-tree
cancellation, byte limits, diagnostics, and acquisition deadlines. Neither retries connections.

OpenSSH owns certificates, agents, ProxyJump/ProxyCommand, host-key verification, and config-file
semantics. Old saved HostName-only records retain their alias-derived agent selection when the
native host config has no explicit agent setting; no destination or account is inferred from that
compatibility lookup. We resolve `ssh -G` before reusing stored credentials and pin the effective account and
destination. POSIX sessions use a private control socket to reuse authentication; Windows uses
independent child connections. Preview forwards always have their own process so closing the
forward removes its listener. Never attach to a user's pre-existing ControlMaster.

Askpass uses a temporary helper plus a capability-protected loopback broker. Credentials never
appear in helper files, arguments, or environment variables. Match passwords to their account and
host, and recheck the selected key's fingerprint before releasing a passphrase. Never answer a
jump-host or unrelated prompt with the destination's secret. Host trust uses OpenSSH known_hosts;
the Electron composition root supplies the confirmation dialog. The SSH service has no Electron
imports. Honor explicit user SSH policy; do not add permissive host-key defaults.

The workspace stream runs a small stdio-to-Unix-socket relay with the Node binary already bundled
beside the daemon. Closing the relay closes only that attachment. It does not launch, signal, or
restart the daemon and does not require an upgrade of an existing installation. Runtime operations
(files, terminals, ACP) remain on the workspace Wire connection.

## Verification

The ordinary node test suite includes isolated real-sshd tests. Install `ssh`, `ssh-keygen`,
`ssh-agent`, `ssh-add`, and `sshd` on POSIX test hosts; `EMDASH_TEST_SSHD` can override the daemon
path. CI installs these tools. Fixtures use temporary keys, CA, agents, configuration and known_hosts;
they must never modify the user's SSH files or agent. Missing tools fail the tests. Native daemon
fixtures are excluded on Windows; subprocess and lifecycle tests still apply there.

Cover agent-only certificate authentication (private key removed after loading), encrypted keys,
host-trust acceptance/rejection, alias proxy routing, multiplexed and independent connections,
remote exit status, binary streams, IPv4/IPv6 forwards, cancellation, and stale generations.
IPv6 tests may skip locally when the kernel disables IPv6; CI requires IPv6. Native Windows/macOS
smoke checks and the opt-in Docker workspace-server test remain useful release validation.

The backend probes `ssh -V` before applying session directives introduced in OpenSSH 8.7. Older
clients omit those directives; newer clients explicitly disable backgrounding and stdin suppression.
The version probe is bounded and does not change user config. Password integration tests can also
run against the repository's isolated remote-machine Docker image: expose container port 22 on a
loopback port and set `EMDASH_TEST_PASSWORD_SSH_PORT` for the authentication suite (fixture account
`devuser` / `devpass`). The helper is exercised through actual OpenSSH prompts in these tests.
