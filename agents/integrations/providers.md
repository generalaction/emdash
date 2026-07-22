# Providers

## Source Of Truth

- `packages/plugins/src/agents/registry.ts`
- `packages/plugins/src/agents/impl/`
- `src/main/core/dependencies/dependency-managers.ts`
- `src/main/core/pty/`

## Current Providers (35)

codex, claude, grok, devin, qwen, qoder, droid, antigravity, cursor, copilot, amp, commandcode, opencode, hermes, charm, auggie, goose, kimi, kilocode, kiro, rovo, cline, codebuddy, continue, codebuff, freebuff, mistral, jules, junie, oh-my-pi, pi, autohand, letta, mimocode, zero

## Current ACP-Capable Providers (22)

codex, claude, opencode, grok, devin, qwen, qoder, droid, cursor, copilot, hermes, auggie, goose, kimi, kilocode, kiro, cline, mistral, junie, mimocode, oh-my-pi, codebuddy

## Provider Metadata Includes

- provider metadata and icon assets
- PATH host dependency definitions and optional self-update argv descriptors
- prompt delivery behavior
- auto-approve, ACP, hooks, MCP, model, session, trust, and plugin capabilities

## Agent Hooks And Notifications

Agent activity, completion, and attention states come from explicit hooks or plugins
installed by the `tui-agents` runtime in `packages/core/src/runtimes/tui-agents/`. Emdash
does not infer agent status from terminal output. If a provider has no hook/plugin integration
for an event, the renderer should not show or notify an inferred status for that event.

## Provider Runtime Notes

- Host dependencies are resolved by the host-scoped `HostDependencies` Wire component.
  Provider plugins declare PATH-only definitions (`binaryNames`, install guidance, and optional
  update argv). Runtimes receive only the narrow resolver contract and must not infer package
  managers, fetch latest versions, or keep a second executable cache.
- A provider self-update command runs directly as argv against the selected PATH binary. There is no
  interpolated shell command and no uninstall/install lifecycle in provider metadata. Future managed
  sources such as Nix should add new source and selection variants without changing runtime spawn
  injection.
- Claude uses deterministic `--session-id` values for conversation isolation.
- Agents that cannot receive an automated initial prompt via argv or stdin declare `pty-only`
  prompt delivery. Their TUI opens without an initial prompt, and automation flows exclude them
  unless they also support ACP.
- `packages/core/src/runtimes/tui-agents/` owns hook ingestion, hook config/plugin installation, and the agent state LiveModel. `src/main/core/agent-status/` projects those runtime states into the conversation SQLite/cache state, while `src/services/notifications/` turns deliverable agent events into the persisted notification feed, batched sound delivery, and Electron OS notifications over the desktop Wire contract.
- Qwen Code hooks use the documented Qwen settings schema in `.qwen/settings.json`. Emdash installs command hooks for permission requests and session end/stop events while preserving unrelated user hooks.

## Adding Or Changing A Provider

1. add or update the plugin in `packages/plugins/src/agents/impl/` and register it in
   `packages/plugins/src/agents/registry.ts`
2. update allowlisted agent env vars in `src/main/core/pty/pty-env.ts` if needed
3. add or update hook/plugin installation and parsing in the provider plugin if the provider
   supports explicit events; `tui-agents` installs and hosts those hooks at runtime
4. validate PATH dependency behavior through the `HostDependencies` component and resolver contract
5. add or update tests for any non-standard behavior
