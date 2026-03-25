# Providers

## Source Of Truth

- `src/shared/agent-provider-registry.ts`
- `src/main/core/dependencies/dependency-manager.ts`
- `src/main/core/pty/`

## Current Providers (22)

codex, claude, qwen, droid, gemini, cursor, copilot, amp, opencode, charm, auggie, goose, kimi, kilocode, kiro, rovo, cline, continue, codebuff, mistral, pi, autohand

## Provider Metadata Includes

- CLI and detection commands
- version args
- install command and docs URL
- auto-approve flags
- initial prompt handling
- keystroke injection behavior
- resume and session flags
- optional plan activation and auto-start commands

## Agent Event Classifiers

Each provider has a terminal output classifier in `src/main/core/conversations/impl/agent-event-classifiers/`. These parse agent terminal output to detect events (task completion, errors, etc.) and forward them to the renderer via the agent hooks module (`src/main/core/agent-hooks/`).

## Provider Runtime Notes

- Claude uses deterministic `--session-id` values for conversation isolation.
- Agents with no CLI prompt flag (e.g., Amp, OpenCode) use keystroke injection — Emdash types the prompt into the TUI after startup.
- `src/main/core/agent-hooks/service.ts` forwards hook events to renderer windows and can show OS notifications. Also writes hook config files (`.claude/settings.local.json`, `.codex/config.toml`) into worktrees.

## Adding Or Changing A Provider

1. update `src/shared/agent-provider-registry.ts`
2. update allowlisted agent env vars in `src/main/core/pty/pty-env.ts` if needed
3. add an agent event classifier in `src/main/core/conversations/impl/agent-event-classifiers/`
4. validate detection behavior in `src/main/core/dependencies/`
5. add or update tests for any non-standard behavior
