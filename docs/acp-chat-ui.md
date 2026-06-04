# ACP Chat UI

Emdash supports Agent Client Protocol (ACP) chat as an optional conversation runtime for
compatible local agents.

## Runtime Choice

- Terminal UI remains the default for every provider.
- Chat UI is available only for providers marked as ACP-capable and with an ACP stdio command.
- Terminal command settings and ACP command settings are separate.
- Remote/SSH conversations fall back to Terminal UI in this pass.

## Supported Providers

The built-in ACP commands are based on the ACP agents page and registry where available:

- Amp: `amp-acp`
- Auggie: `auggie --acp`
- Autohand Code: `npx -y @autohandai/autohand-acp@0.2.1`
- Claude Code: `npx -y @agentclientprotocol/claude-agent-acp@0.40.0`
- Cline: `cline --acp`
- Codex: `npx -y @zed-industries/codex-acp@0.15.0`
- Cursor: `cursor-agent acp`
- Droid: `npx -y droid@0.140.0 exec --output-format acp-daemon`
- Gemini: `gemini --acp`
- GitHub Copilot: `copilot --acp`
- Goose: `goose acp`
- Grok: `grok agent stdio`
- Junie: `junie --acp=true`
- Kimi: `kimi acp`
- Kilocode: `npx -y @kilocode/cli@7.3.21 acp`
- Mistral Vibe: `vibe-acp`
- OpenCode: `opencode acp`
- Pi: `npx -y pi-acp@0.0.27`
- Qwen Code: `qwen --acp --experimental-skills`

Users can override the ACP command in provider execution settings. Emdash launches the command as an
argv process with shell execution disabled.

## Protocol Behavior

For Chat UI conversations, the main process:

- spawns the ACP agent over stdio;
- sends `initialize` with ACP v1 and no filesystem or terminal client capabilities;
- creates a session with `session/new`;
- uses `session/resume` or `session/load` only when the agent advertises support;
- sends prompts through `session/prompt`;
- streams `session/update` notifications to the renderer as typed events;
- calls `session/cancel` for turn cancellation;
- kills the child process when the conversation is dehydrated, deleted, or the task is destroyed.

## Permissions

ACP permission requests are rendered inline in the chat pane. Manual approval is the default.
When the existing conversation auto-approve setting is enabled, Emdash may choose an allow option
from the ACP request. Cancelling a turn responds to all pending permission requests with the ACP
`cancelled` outcome.

## Diagnostics

ACP stderr, malformed stdout, launch failures, initialize failures, protocol version mismatches, and
JSON-RPC errors are captured in bounded redacted diagnostics. Prompt text and raw transcripts are not
sent to telemetry.

## Disabled Capabilities

For V1, Emdash does not advertise ACP filesystem or terminal client capabilities. Those require
separate path validation, workspace-provider handling, existing diff/editor integration, PTY cleanup,
and focused tests.
