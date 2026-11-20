# Emdash Classic

Emdash Classic is the open-source desktop app for running coding agents in parallel. Run Claude Code, Codex, OpenCode, and more in separate Git worktrees, on your machine or over SSH. Review diffs and open PRs without leaving the app. Available for macOS, Windows, and Linux.

<div align="center">

[Download](https://emdash.com/download) · [Docs](https://emdash.com/docs) · [Releases](https://github.com/generalaction/emdash/releases/latest) · [Discord](https://discord.gg/f2fv7YxuR2) · [Contributing](CONTRIBUTING.md)

<br />

[![Apache 2.0 License](https://img.shields.io/badge/License-Apache_2.0-555555.svg?labelColor=333333&color=666666)](./LICENSE.md)
[![Downloads](https://img.shields.io/github/downloads/generalaction/emdash/total?labelColor=333333&color=666666)](https://github.com/generalaction/emdash/releases)
[![GitHub Stars](https://img.shields.io/github/stars/generalaction/emdash?labelColor=333333&color=666666&logo=github)](https://github.com/generalaction/emdash)
[![Last Commit](https://img.shields.io/github/last-commit/generalaction/emdash?labelColor=333333&color=666666)](https://github.com/generalaction/emdash/commits/main)
[![Commit Activity](https://img.shields.io/github/commit-activity/m/generalaction/emdash?labelColor=333333&color=666666)](https://github.com/generalaction/emdash/graphs/commit-activity)

[![Discord](https://img.shields.io/badge/Discord-join-%235462eb?labelColor=%235462eb&logo=discord&logoColor=%23f5f5f5)](https://discord.gg/f2fv7YxuR2)
<a href="https://www.ycombinator.com"><img src="https://img.shields.io/badge/Y%20Combinator-W26-orange" alt="Y Combinator W26"></a>
[![Follow @emdashcom on X](https://img.shields.io/twitter/follow/emdashcom?logo=X&color=%23f5f5f5)](https://twitter.com/intent/follow?screen_name=emdashcom)

</div>

<img alt="Emdash Classic product screenshot" src="https://emdash.com/media/blog/public-v1-beta/v1beta.jpg" />

## What You Can Do

- Run multiple coding agents at once without juggling terminals.
- Keep every agent isolated in its own Git worktree and branch.
- Send issues and tickets from Linear, GitHub, Jira, GitLab, Asana, Featurebase,
  Monday.com, Forgejo, Plain, or YouTrack into an agent.
- Review diffs, create pull requests, inspect CI checks, and merge from one place.
- Work locally or on your own remote machines over SSH/SFTP.

## Installation

| Platform | Install |
| --- | --- |
| macOS | `brew install --cask emdash` · [Apple Silicon](https://github.com/generalaction/emdash/releases/latest/download/emdash-arm64.dmg) · [Intel](https://github.com/generalaction/emdash/releases/latest/download/emdash-x64.dmg) |
| Windows | [Installer](https://github.com/generalaction/emdash/releases/latest/download/emdash-x64.msi) · [Portable](https://github.com/generalaction/emdash/releases/latest/download/emdash-x64.exe) |
| Linux x64 | [AppImage](https://github.com/generalaction/emdash/releases/latest/download/emdash-x86_64.AppImage) · [DEB](https://github.com/generalaction/emdash/releases/latest/download/emdash-amd64.deb) · [RPM](https://github.com/generalaction/emdash/releases/latest/download/emdash-x86_64.rpm) |
| Linux ARM64 | [AppImage](https://github.com/generalaction/emdash/releases/latest/download/emdash-arm64.AppImage) · [DEB](https://github.com/generalaction/emdash/releases/latest/download/emdash-arm64.deb) · [RPM](https://github.com/generalaction/emdash/releases/latest/download/emdash-aarch64.rpm) |

See the [latest release](https://github.com/generalaction/emdash/releases/latest) for
all desktop builds.

## Agents

The app automatically detects installed provider CLIs, including Claude Code, Codex, Cursor,
OpenCode, Amp, Devin, Qwen Code, Droid, and GitHub Copilot.

For agents that support lifecycle hooks, the app adds marked entries to the agent's user config.
These hooks track status, enable notifications, and support resuming sessions. They do nothing
outside sessions started in the app.

See [Providers](https://emdash.com/docs/providers) for the full list, setup commands,
and provider-specific behavior.

## Remote Projects

Connect to remote machines with SSH/SFTP and run the same parallel workflow on remote
codebases. You can authenticate with an SSH agent, a key, or a password. OpenSSH certificates held
by the agent also work. The app stores credentials in your OS keychain.

See [Remote Projects](https://emdash.com/docs/remote-development/remote-projects) for setup details.

## Privacy

The app is local-first. It stores app state in a local SQLite database and does not send your code
or chats to Emdash servers.

Agent CLIs may send code, prompts, and context to their own providers. Their data
handling depends on the provider you choose.

Telemetry is optional and can be disabled in Settings or by launching with:

```bash
TELEMETRY_ENABLED=false
```

See [Telemetry](https://emdash.com/docs/telemetry) for details.

## Contributing

Contributions are welcome. Read the [Contributing Guide](CONTRIBUTING.md), open an
issue, or join the [Discord](https://discord.gg/f2fv7YxuR2).

## License

Licensed under the [Apache-2.0 license](LICENSE.md).

Looking to run coding agents with your team, on your own infrastructure or in the cloud? See [Emdash](https://emdash.com).
