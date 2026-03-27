# Remote Development

## Main Files

- `src/main/services/RemotePtyService.ts`
- `src/main/services/RemoteGitService.ts`
- `src/main/services/ssh/`
- `src/main/utils/shellEscape.ts`
- `src/main/utils/sshCommandValidation.ts`

## Current Model

- remote projects are backed by SSH connections
- remote worktrees live under `<project>/.emdash/worktrees/<task-slug>/`
- remote PTYs stream agent shells back to the renderer

## Authentication And Storage

- SSH credentials are managed through the SSH services and OS-backed secret storage
- host key handling is implemented under `src/main/services/ssh/`

## Rules

- treat all shell construction as security-sensitive
- use shared SSH and shell-escaping helpers instead of ad hoc quoting
- confirm whether a feature is local-only before assuming parity on remote projects
