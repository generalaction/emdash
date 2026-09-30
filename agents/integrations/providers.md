# Providers

## Source Of Truth

- `packages/plugins/src/agents/registry.ts`
- `packages/plugins/src/agents/impl/`
- `src/main/core/dependencies/dependency-managers.ts`
- `src/main/core/pty/`

## Current Providers (37)

codex, claude, grok, devin, qwen, qoder, droid, antigravity, cursor, copilot, amp, commandcode, opencode, hermes, charm, auggie, goose, kimi, kilocode, kiro, rovo, cline, codebuddy, continue, codebuff, freebuff, mistral, muse, jules, junie, oh-my-pi, pi, prime-agent, autohand, letta, mimocode, zero

## Current ACP-Capable Providers (23)

codex, claude, opencode, grok, devin, qwen, qoder, droid, cursor, copilot, hermes, auggie, goose, kimi, kilocode, kiro, cline, mistral, junie, mimocode, oh-my-pi, prime-agent, codebuddy

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

Shipped hook integrations install into user-global provider configuration, never into a task
worktree. The provider behavior resolves its root from the same allowlisted environment passed to
the CLI, including provider-specific home overrides and XDG/APPDATA conventions. Paths returned by
hook and file-drop behaviors are relative to that root. `scope: 'workspace'` remains available as
an extension escape hatch, but no built-in provider uses it.

Managed config entries include an Emdash hook-config version marker. On session startup the
installer checks the complete expected entry set before taking a per-root write lock, checks again
under the lock, and writes only when missing or stale. Existing JSON or TOML that cannot be parsed
is left untouched and reported through logging. Global hooks are harmless in sessions outside
Emdash: their commands exit successfully when the Emdash hook server environment is absent.

The global roots used by the built-in integrations are:

| Providers | Root behavior |
| --- | --- |
| Auggie, CodeBuddy, Command Code, Qoder, Grok, Amp, Kilo, Droid, Goose | Fixed home roots (`~/.augment`, `~/.codebuddy`, `~/.commandcode`, `~/.qoder`, `~/.grok`, `~/.amp`, `~/.kilo`, `~/.factory`, `~/.agents`) |
| Claude, Codex, Copilot, Qwen, Kimi, Kiro, Mistral Vibe | Provider home env override with a home fallback |
| OpenCode, MiMoCode, Devin | Provider override where supported, then XDG config on POSIX or APPDATA on Windows |
| Pi | `$PI_CODING_AGENT_DIR` with `~/.pi/agent` fallback |
| Oh My Pi | `$PI_CODING_AGENT_DIR`, then `$PI_CONFIG_DIR`, with `~/.omp/agent` fallback |
| Prime Agent | `$PRIME_AGENT_CODING_AGENT_DIR` with `~/.prime/agent` fallback |
| Antigravity CLI | `~/.gemini/config` |
| Muse Code | `$XDG_CONFIG_HOME/muse`, falling back to `~/.config/muse` on macOS and Linux |

Kimi also keeps the legacy `~/.kimi/config.toml` root synchronized. Kiro maintains both the classic
`agents/emdash.json` format and the standalone `hooks/emdash.json` v1 schema so classic and `--v3`
sessions are covered. The agent details UI obtains read-only installed/pending status through the
host's `agent-config` runtime for both local and remote hosts.

## Provider API Keys

Emdash passes provider API keys through to the agent CLIs it spawns. The allowlisted agent
environment in `packages/core/src/primitives/agent-env/api/index.ts` is the single source of truth
for which variables reach a spawned agent.

[OrcaRouter](https://www.orcarouter.ai) is an OpenAI-compatible gateway that routes to models from
OpenAI, Anthropic, Google, DeepSeek, Qwen, and more through one API key (`sk-orca-…`). OpenCode
resolves `orcarouter/*` models through its models.dev catalog, so setting `ORCAROUTER_API_KEY` lets
you select an OrcaRouter model from the OpenCode model picker.

## Provider Runtime Notes

- Automatic task naming uses the initial conversation's active agent. ACP session titles flow
  through the desktop bridge; TUI agents can submit `{ "name": "Fix login timeout" }` using the
  authenticated `/hook` route with event type `task-name`. Notification titles remain status
  metadata. TUI startup adds the naming instruction only for an eligible fresh session with
  a hook environment. Without an initial prompt, the instruction waits for the first real work
  request. Unsupported agents retain their placeholder.
- The desktop owns task-name eligibility in `tasks.auto_name_conversation_id`. Applying a name
  consumes that marker in the same transaction as the name update. Manual renaming, linking an
  issue, and archiving cancel eligibility. Names use the existing format, capitalization
  preference, 64-character limit, and at most five words; branches and worktree paths retain
  their original identities.
  An empty marker awaits the first conversation created later; null means ineligible or consumed.
- Chat UI contributes `/rename-task` and adds `/rename` only when the provider has not
  advertised that name. Exact bare commands request a fresh name; arguments, paths, and
  multiline messages continue through ordinary prompt handling. The task view's
  `task.nameWithAgent` command invokes the same action.
- Manual naming uses the existing ACP prompt queue and an exact `promptId` correlation.
  A desktop-owned session subscription watches committed transcript revisions so switching
  views does not drop the request. Only the matching successful turn's final assistant label,
  with at most five words and 64 characters, may be applied. The automatic setting does not
  gate this explicit action. Application shutdown or the ten-minute request deadline can
  interrupt an unfinished request; users can submit it again.
- Host dependencies are resolved by the host-scoped `HostDependencies` Wire component.
  Provider plugins declare PATH-only definitions (`binaryNames`, install guidance, and optional
  update argv). Runtimes receive only the narrow resolver contract and must not infer package
  managers, fetch latest versions, or keep a second executable cache.
- Agent list/status reads observe the demand-driven dependency snapshot; they must not force a
  full refresh. Explicit overlapping desktop refreshes share one request, and independent provider
  PATH probes run concurrently so Windows lookup latency does not accumulate across every provider.
- Install command metadata stays sudo-free and declares an elevation policy. Commands that always
  require elevation are wrapped by the host-dependency runtime, while npm-style `on-failure`
  commands first run with user privileges and may be explicitly retried with passwordless sudo
  after a permission-classified failure. Homebrew and user-local installers must remain
  `never`-elevated.
- A provider self-update command runs directly as argv against the selected PATH binary. There is no
  interpolated shell command and no uninstall/install lifecycle in provider metadata. Future managed
  sources such as Nix should add new source and selection variants without changing runtime spawn
  injection.
- Executable selection belongs to the host-dependency runtime. Auto follows the plugin's binary
  names on the host PATH; a saved path or CLI-name override resolves independently of discovery.
  The resolver accepts an optional proposed selection, so validation and startup share one
  operation and implementation. Invalid overrides block launch and
  never fall back to Auto. Settings save only after validation, and failed saves retain the previous
  selection. Existing path-selection JSON remains valid; CLI selections add a `kind: 'cli'` variant
  with a `command` field. Overrides accept executable files or PATH names; use a wrapper script for
  commands with arguments, such as `srt claude`.
- Claude uses deterministic `--session-id` values for conversation isolation.
- Static plugin model catalogs supply suggestions before a conversation starts. Keep their IDs
  compatible with the provider's ACP catalog and terminal model flag. Preserve saved IDs that are
  absent from the static suggestions; only the live ACP catalog can determine whether a chat
  selection is unsupported on that host.
- Codex ACP exposes collaboration mode separately from permission mode. The ACP runtime maps the
  provider-owned `collaboration_mode` config category to the chat composer's Default/Plan selector
  and persists that selection with the conversation; filesystem and approval controls remain in
  the existing permission-mode selector.
- Agents that cannot receive an automated initial prompt via argv or stdin declare `pty-only`
  prompt delivery. Their TUI opens without an initial prompt, and automation flows exclude them
  unless they also support ACP.
- `packages/core/src/runtimes/tui-agents/` owns hook ingestion, hook config/plugin installation, and the agent state LiveModel. `src/main/core/agent-status/` projects those runtime states into the conversation SQLite/cache state, while `src/services/notifications/` turns deliverable agent events into the persisted notification feed, batched sound delivery, and Electron OS notifications over the desktop Wire contract.
- Qwen Code hooks use the documented Qwen settings schema in `$QWEN_HOME/settings.json` (falling back to `~/.qwen/settings.json`). Emdash installs command hooks for permission requests and session end/stop events while preserving unrelated user hooks.
- Antigravity CLI installs lifecycle hooks in `~/.gemini/config/plugins/emdash/` to report
  working and completion status while preserving existing user hooks.
- Muse Code installs managed hooks through `managed_hooks_path` in `settings.json`.
  `SessionStart`, `UserPromptSubmit`, and `Stop` report session, working, and completion events.
  `managed_hooks_env_vars` forwards the Emdash hook routing variables.
  Existing hooks are preserved; paths outside the config root are rejected.
- Prime Agent uses its native ACP stdio mode (`prime-agent --mode acp`). Its TUI extension reports
  session file paths, turn starts, and turn completion for resume and notification support. Emdash
  synchronizes standard stdio and HTTP MCP definitions in `~/.prime/agent/settings.json`. ACP
  sessions receive those definitions through `session/new`, and Prime exposes them to the model
  through its pre-imported `mcp` Python program.

## Adding Or Changing A Provider

1. add or update the plugin in `packages/plugins/src/agents/impl/` and register it in
   `packages/plugins/src/agents/registry.ts`
2. update allowlisted agent env vars in `packages/core/src/primitives/agent-env/api/index.ts` if needed
3. add or update hook/plugin installation and parsing in the provider plugin if the provider
   supports explicit events; `tui-agents` installs and hosts those hooks at runtime
4. validate PATH dependency behavior through the `HostDependencies` component and resolver contract
5. add or update tests for any non-standard behavior
