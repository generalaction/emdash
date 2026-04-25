# Remote Development

## Main Files

- `src/main/core/ssh/` — connection management, credentials, config parsing
- `src/main/core/pty/ssh2-pty.ts`
- `src/main/core/fs/impl/ssh-fs.ts`
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
