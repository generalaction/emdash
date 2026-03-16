# Providers

## Source Of Truth

- `src/shared/providers/registry.ts`
- `src/main/services/ConnectionsService.ts`
- `src/main/services/ptyManager.ts`

## Provider Metadata Includes

- CLI and detection commands
- version args
- install command and docs URL
- auto-approve flags
- initial prompt handling
- keystroke injection behavior
- resume and session flags
- optional plan activation and auto-start commands

## Provider Runtime Notes

- Claude uses deterministic `--session-id` values for conversation isolation.
- Codex session recovery uses `src/main/services/CodexSessionService.ts`.
- Claude and OpenCode use hook/config helpers to emit structured events back into Emdash.
- `src/main/services/AgentEventService.ts` forwards hook events to renderer windows and can show OS notifications.

## Adding Or Changing A Provider

1. update `src/shared/providers/registry.ts`
2. update allowlisted agent env vars in `src/main/services/ptyManager.ts` if needed
3. validate detection behavior in `ConnectionsService.ts`
4. add or update tests for any non-standard behavior
