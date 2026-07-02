# Remote Development

## Main Files

- `src/main/core/ssh/` — split into `config/` (`sshConfigParser.ts`, `resolve-ssh-config.ts`),
  `connect/` (connection config resolution and testing), `credentials/`
  (`ssh-credential-service.ts`), `lifecycle/` (`ssh-connection-manager.ts`,
  `ssh-client-proxy.ts`), plus a top-level `controller.ts`
- `src/main/core/pty/ssh2-pty.ts`
- `src/main/core/runtime/legacy/ssh-file-system.ts` — SSH-backed filesystem (`IFileSystem`),
  built on `ssh-legacy-fs.ts` (SFTP operations)
- `src/main/core/terminals/impl/ssh-terminal-provider.ts`
- `src/main/utils/shellEscape.ts`

## Current Model

- remote projects are backed by SSH connections
- remote worktrees live under `<project>/.emdash/worktrees/<task-slug>/`
- remote PTYs stream agent shells back to the renderer

## Authentication And Storage

- SSH credentials are managed through the SSH services and OS-backed secret storage
- host key handling is implemented under `src/main/core/ssh/`

## Rules

- treat all shell construction as security-sensitive
- use shared SSH and shell-escaping helpers instead of ad hoc quoting
- confirm whether a feature is local-only before assuming parity on remote projects
