# Providers

## Source Of Truth

- `src/shared/agent-provider-registry.ts`
- `src/main/core/dependencies/dependency-manager.ts`
- `src/main/core/pty/`

## Current Providers (30)

codex, claude, grok, devin, qwen, droid, gemini, antigravity, cursor, copilot, amp, opencode, hermes, charm, auggie, goose, kimi, kilocode, kiro, rovo, cline, continue, codebuff, freebuff, mistral, jules, junie, pi, autohand, letta

## Provider Metadata Includes

- CLI and detection commands
- version args
- install command and docs URL
- auto-approve flags
- initial prompt handling
- keystroke injection behavior
- resume and session flags
- optional plan activation and auto-start commands

## Agent Hooks And Notifications

Agent activity, completion, and attention notifications come from explicit hooks or plugins
installed by `src/main/core/agent-hooks/`. Emdash does not infer agent status from terminal
output. If a provider has no hook/plugin integration for an event, the renderer should not show
or notify an inferred status for that event.

## Provider Runtime Notes

- Claude uses deterministic `--session-id` values for conversation isolation.
- Agents with no CLI prompt flag (e.g., Amp, OpenCode) use keystroke injection — Emdash types the prompt into the TUI after startup.
- `src/main/core/agent-hooks/service.ts` forwards hook events to renderer windows and can show OS notifications. It also writes hook config files for hook-capable providers, including `.claude/settings.local.json`, `.qwen/settings.json`, and provider-specific global hook files.
- Qwen Code hooks use the documented Qwen settings schema in `.qwen/settings.json`. Emdash installs command hooks for permission requests and session end/stop events while preserving unrelated user hooks.

## Adding Or Changing A Provider

1. update `src/shared/agent-provider-registry.ts`
2. update allowlisted agent env vars in `src/main/core/pty/pty-env.ts` if needed
3. add or update hook/plugin installation in `src/main/core/agent-hooks/` if the provider
   supports explicit events
4. validate detection behavior in `src/main/core/dependencies/`
5. add or update tests for any non-standard behavior
