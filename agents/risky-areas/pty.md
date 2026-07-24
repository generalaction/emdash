# Risky Area: PTY And Sessions

## Main Files

- `src/main/core/pty/` — `local-pty.ts`, `ssh2-pty.ts`, `pty.ts`, `pty-env.ts`, `pty-session-registry.ts`, `spawn-utils.ts`, `exit-signals.ts`, `controller.ts`
- `src/main/core/terminals/` — terminal lifecycle, local and SSH terminal providers
- `packages/core/src/runtimes/tui-agents/` — PTY-backed agent sessions, runtime-owned hook server, hook installation, and agent state LiveModels
- `src/main/core/agent-status/` — desktop projection of runtime agent states into the conversation cache
- `src/services/notifications/` — desktop notification feed, batching, sound sink, and OS notification sink

## Core Risks

- PTY cleanup and exit handling
- resize behavior
- shell quoting and Windows command wrapping
- tmux lifecycle
- provider-specific resume/session behavior
- env passthrough safety

## Rules

- use the allowlisted env passthrough model in `src/main/core/pty/pty-env.ts`
- do not weaken quoting or spawn behavior casually
- validate both direct spawn and shell-wrapped spawn cases when changing PTY startup logic
- confirm renderer event flow if hook/plugin payload or agent status behavior changes
