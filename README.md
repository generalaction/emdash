<img alt="Emdash" src="https://github.com/user-attachments/assets/a2ecaf3c-9d84-40ca-9a8e-d4f612cc1c6f" />

<div align="center">

[Download](https://emdash.sh/download) · [Docs](https://emdash.sh/docs) · [Releases](https://github.com/generalaction/emdash/releases/latest) · [Discord](https://discord.gg/f2fv7YxuR2) · [Contributing](CONTRIBUTING.md)

</div>

Emdash is a desktop app for running AI coding agents in parallel. Each task runs in its
own Git worktree, so you can explore multiple fixes or features at once, review the
diffs, and merge what works.

It works with local projects and remote machines over SSH. Bring the CLI agents you
already use: Claude Code, Codex, OpenCode, Gemini, Amp, and more.

<img alt="Emdash product screenshot" src="https://emdash.sh/media/blog/public-v1-beta/v1beta.jpg" />

## What You Can Do

- Run multiple coding agents at once without juggling terminals.
- Keep every agent isolated in its own Git worktree and branch.
- Send issues and tickets from Linear, GitHub, Jira, GitLab, Asana, Featurebase,
  Monday.com, Forgejo, or Plain into an agent.
- Review diffs, create pull requests, inspect CI checks, and merge from one place.
- Work locally or on your own remote machines over SSH/SFTP.

## Installation

| Platform | Install |
| --- | --- |
| macOS | `brew install --cask emdash` · [Apple Silicon](https://releases.emdash.sh/emdash-arm64.dmg) · [Intel](https://releases.emdash.sh/emdash-x64.dmg) |
| Windows | [Installer](https://releases.emdash.sh/emdash-x64.msi) · [Portable](https://releases.emdash.sh/emdash-x64.exe) |
| Linux | [AppImage](https://releases.emdash.sh/emdash-x86_64.AppImage) · [Debian package](https://releases.emdash.sh/emdash-amd64.deb) |

See the [latest release](https://github.com/generalaction/emdash/releases/latest) for
all desktop builds.

## Agents

Emdash detects installed provider CLIs automatically. It supports agents like Claude
Code, Codex, Cursor, OpenCode, Gemini, Amp, Devin, Qwen Code, Droid, and GitHub
Copilot.

See [Providers](https://emdash.sh/docs/providers) for the full list, setup commands,
and provider-specific behavior.

## Remote Projects

Connect to remote machines with SSH/SFTP and run the same parallel workflow on remote
codebases. Emdash supports SSH agent, key, and password authentication, with credentials
stored in your OS keychain.

See [Remote Projects](https://emdash.sh/docs/remote-projects) and
[Bring Your Own Infrastructure](https://emdash.sh/docs/bring-your-own-infrastructure)
for setup details.

## Privacy

Emdash is local-first. App state is stored in a local SQLite database, and Emdash does
not send your code or chats to Emdash servers.

Agent CLIs may send code, prompts, and context to their own providers. Their data
handling depends on the provider you choose.

Telemetry is optional and can be disabled in Settings or by launching with:

```bash
TELEMETRY_ENABLED=false
```

See [Telemetry](https://emdash.sh/docs/telemetry) for details.

## Contributing

Contributions are welcome. Read the [Contributing Guide](CONTRIBUTING.md), open an
issue, or join the [Discord](https://discord.gg/f2fv7YxuR2).

## License

Licensed under the [Apache-2.0 license](LICENSE.md).
