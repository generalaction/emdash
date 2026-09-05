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
