# Risky Area: SSH And Shell Escaping

## Main Files

- `src/main/services/ssh/`
- `src/main/services/RemotePtyService.ts`
- `src/main/services/RemoteGitService.ts`
- `src/main/utils/shellEscape.ts`
- `src/main/utils/sshCommandValidation.ts`
- `src/main/utils/sshConfigParser.ts`

## Rules

- treat remote shell construction as security-sensitive
- use shared escaping and validation helpers
- do not bypass path-safety or shell validation helpers
- verify how a change affects both connection setup and command execution
