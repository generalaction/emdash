# Risky Area: SSH And Shell Escaping

## Main Files

- `src/main/core/ssh/` — `lifecycle/ssh-connection-manager.ts`, `credentials/ssh-credential-service.ts`,
  `lifecycle/ssh-client-proxy.ts`, `config/sshConfigParser.ts`, `connect/resolve-ssh-connect-config.ts`,
  top-level `controller.ts`
- `src/main/core/runtime/legacy/ssh-file-system.ts` (+ `ssh-legacy-fs.ts` SFTP backend)
- `src/main/core/pty/ssh2-pty.ts`
- `src/main/core/terminals/impl/ssh-terminal-provider.ts`
- `src/main/utils/shellEscape.ts`

## Rules

- treat remote shell construction as security-sensitive
- use shared escaping and validation helpers
- do not bypass path-safety or shell validation helpers
- verify how a change affects both connection setup and command execution
