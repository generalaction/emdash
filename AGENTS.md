# Agents

emdash orchestrates local-first coding agents that work against isolated Git worktrees. This guide explains the agent model, supported providers, installation requirements, and how to launch, monitor, and troubleshoot agent runs.

## Agent Modes

- **Streaming chat (Codex, Claude Code):** The renderer connects directly to the CLI and renders streamed output in the sidebar conversation view. Runs start from the right sidebar prompt or the Run Launcher.
- **Terminal passthrough (all other CLIs):** emdash opens a dedicated terminal pane inside the workspace window and launches the provider’s CLI command. You interact with these agents exactly as you would in a local shell.
- **Plan mode:** Toggle plan mode from the provider bar to inject `EMDASH_PLAN_MODE=1` and `EMDASH_PLAN_FILE=<worktree>/.emdash/planning.md` into the spawned process. Plan mode keeps the agent read-only until you intentionally exit the mode.

## Supported Providers

| Provider | CLI command | Mode | Notes |
| --- | --- | --- | --- |
| OpenAI Codex | `codex` | Streaming chat | Requires Codex CLI authentication. Honors sandbox/approval env vars (see below). |
| Claude Code | `claude` | Streaming chat | Uses the Claude Code CLI or, when available, the `@anthropic/claude-code-sdk` for richer streaming. |
| Cursor | `cursor-agent` | Terminal passthrough | Install from https://cursor.com/install. |
| GitHub Copilot | `copilot` | Terminal passthrough | Requires Copilot CLI login (`copilot login`). |
| Amp Code | `amp` | Terminal passthrough | Install instructions: https://ampcode.com/manual#install. |
| OpenCode | `opencode` | Terminal passthrough | Docs: https://opencode.ai/docs/cli/. |
| Charm Crush | `crush` | Terminal passthrough | Install from https://github.com/charmbracelet/crush. |
| Augment (Auggie) | `auggie` | Terminal passthrough | Install from https://docs.augmentcode.com/cli/overview. |
| Qwen Code | `qwen` | Terminal passthrough | Install from https://github.com/QwenLM/qwen-code. |
| Factory Droid | `droid` | Terminal passthrough | Install from https://docs.factory.ai/cli/getting-started/quickstart. |
| Gemini CLI | `gemini` | Terminal passthrough | Install from https://github.com/google-gemini/gemini-cli. |
| Goose | `goose` | Terminal passthrough | Install from https://block.github.io/goose/docs/quickstart/. |

> Providers must be on your `$PATH`. If a CLI fails to launch, emdash shows an inline banner with the provider’s help URL.

## Install & Authenticate the Streaming Providers

### Codex CLI

```bash
npm install -g @openai/codex
# or
brew install codex

codex            # authenticate and verify access
```

Codex sandbox controls (read from the Electron main process):

- `CODEX_SANDBOX_MODE` — `read-only` (default for plan mode) or `workspace-write`.
- `CODEX_APPROVAL_POLICY` — `never`, `on-request`, `on-failure`, `untrusted`, or `auto`.
- `CODEX_DANGEROUSLY_BYPASS` / `CODEX_DANGEROUSLY_BYPASS_APPROVALS_AND_SANDBOX` — set to `true` to run with `--dangerously-bypass-approvals-and-sandbox`.

### Claude Code CLI

```bash
npm install -g @anthropic-ai/claude-code
claude          # first-run login shell
/login          # authenticate inside the CLI prompt
```

Optional: install `@anthropic/claude-code-sdk` locally; if present, emdash prefers the SDK for lower-latency streaming and cancellation support before falling back to the CLI.

## Launching Agent Runs

1. **Open a repository** from the sidebar or via the “Open Project” button. emdash syncs Git metadata and remote URLs.
2. **Create or select a workspace.** Each workspace corresponds to a Git worktree located outside the repo root (`../worktrees/<workspace>`).
3. **Choose a provider:**
   - For Codex/Claude, use the right sidebar chat prompt or the Run Launcher modal.
   - For terminal-only providers, switch to the provider tab in the chat area; emdash automatically launches the CLI when the terminal gains focus.
4. **Provide a task prompt.** The Run Launcher lets you choose the provider (`claude-code` or `openai-agents`), number of parallel agents (1–5), and the base branch for new worktrees.
5. **Monitor progress.** Streaming providers populate the conversation view with output and reasoning blocks. Terminal providers stream raw terminal output; use the provider banner to jump to docs or resolve missing CLI errors.

Branch templates live under Settings → Repository. By default, emdash creates branches like `agent/<slug>-<timestamp>` and pushes the branch on creation (toggle `Auto-push` to disable).

## Logs, Artifacts, and History

- **Agent stream logs:** Stored outside your repo under the Electron app data folder:
  - Codex: `<userData>/logs/codex/<workspaceId>/codex-stream.log`
  - Other providers: `<userData>/logs/agent/<providerId>/<workspaceId>/stream.log`
  - macOS example: `~/Library/Application Support/emdash/logs/…`
- **Conversation history:** Saved in the local SQLite database (`<userData>/emdash.db`). Streaming completions from Codex are persisted so transcripts survive window reloads.
- **Plan files:** When plan mode is enabled, providers receive `EMDASH_PLAN_FILE=<worktree>/.emdash/planning.md`. Agents can append their plan there without editing project files.

## Troubleshooting

- **CLI not detected:** Ensure the binary is on `$PATH` for the Electron environment. Launch emdash from a terminal session if your shell profile exports PATH entries.
- **Codex run ends immediately:** Check `codex-stream.log` for install/auth errors. Re-authenticate with `codex login` if the token expired.
- **Claude streaming stalls:** If the SDK is installed, ensure it matches the CLA CLI version. Remove `node_modules/@anthropic/claude-code-sdk` to force CLI fallback.
- **Workspace stuck in plan mode:** Toggle plan mode off in the provider bar or delete the `.emdash/planning.md` file in the worktree.
- **Terminating a run:** Use the stop button in the chat UI (streaming mode) or send the provider-specific cancel command (`Esc`, `/cancel`, etc.) inside the terminal pane.

## Where to Go Next

- Update provider defaults or branch templates in **Settings → Repository**.
- Pair runs with issues from Linear, GitHub, or Jira via the workspace metadata panel.
- Share feedback or request new provider integrations in GitHub Issues.
