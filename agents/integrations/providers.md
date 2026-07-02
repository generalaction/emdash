# Providers

## Source Of Truth

Provider capabilities and behavior (ACP, MCP, hooks, models, prompt building, trust) are
defined plugin-first:

- `packages/plugins/src/agents/impl/<provider>/` — one plugin per provider: capability
  declarations plus behavior implementations
- `packages/plugins/src/agents/registry.ts` — the runtime `pluginRegistry` that main-process
  services query (`pluginRegistry.get(agentId)`, `pluginRegistry.getAll()`)
- `packages/core/src/agents/plugins/` — the capability framework (`definePlugin`,
  `registerPluginBehavior`, and capability contracts for acp, mcp, hooks, models, prompt,
  sessions, trust, etc. — see `PLUGIN_CAPABILITIES` in `packages/core/src/agents/plugins/index.ts`)

`src/shared/core/agents/agent-provider-registry.ts` is UI / legacy-PTY parity metadata
(display name, icon, docUrl, description, and legacy prompt/resume/session flags used mainly
by `terminalOnly` providers) — treat it as a secondary, renderer-facing registry, not the
primary provider-definition source. `src/main/core/dependencies/` handles CLI
detection/probing, and `src/main/core/pty/` handles legacy PTY spawn behavior.

## Current Providers

See `AGENT_PROVIDER_IDS` in `src/shared/core/agents/agent-provider-registry.ts` for the
canonical, always-current list — avoid hardcoding a count or name list here, it drifts (see
`agents/README.md` maintenance rules).

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
- Agents that cannot receive an interactive initial prompt via argv or stdin use keystroke
  injection — Emdash types the prompt into the TUI after startup.
- `src/main/core/agent-hooks/agent-hook-service.ts` forwards hook events to renderer windows and can show OS notifications. It also writes hook config files for hook-capable providers, including `.claude/settings.local.json`, `.qwen/settings.json`, and provider-specific global hook files.
- Qwen Code hooks use the documented Qwen settings schema in `.qwen/settings.json`. Emdash installs command hooks for permission requests and session end/stop events while preserving unrelated user hooks.

## Adding Or Changing A Provider

1. add or update the plugin under `packages/plugins/src/agents/impl/<provider>/`
   (capabilities + behavior: acp, mcp, hooks, prompt, sessions, trust as applicable) and
   register it in `packages/plugins/src/agents/registry.ts`
2. add or update the UI parity entry in `src/shared/core/agents/agent-provider-registry.ts`
   (display metadata, icon, docUrl, legacy PTY flags)
3. update allowlisted agent env vars in `src/main/core/pty/pty-env.ts` if needed
4. add or update hook/plugin installation in `src/main/core/agent-hooks/` if the provider
   supports explicit events
5. validate detection behavior in `src/main/core/dependencies/`
6. add or update tests for any non-standard behavior
