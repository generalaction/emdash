# Risky Area: PTY And Sessions

## Main Files

- `src/main/services/ptyManager.ts`
- `src/main/services/ptyIpc.ts`
- `src/main/services/AgentEventService.ts`
- `src/main/services/ClaudeHookService.ts`
- `src/main/services/OpenCodeHookService.ts`
- `src/main/services/CodexSessionService.ts`

## Core Risks

- PTY cleanup and exit handling
- resize behavior
- shell quoting and Windows command wrapping
- persistent session backend lifecycle (`tmux`, `zellij`)
- provider-specific resume/session behavior
- env passthrough safety

## Rules

- use the allowlisted env passthrough model in `AGENT_ENV_VARS`
- do not weaken quoting or spawn behavior casually
- validate both direct spawn and shell-wrapped spawn cases when changing PTY startup logic
- confirm renderer event flow if hook payload or notification behavior changes
