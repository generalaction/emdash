<img width="4856" height="1000" alt="gh_banner" src="https://github.com/user-attachments/assets/7c7c6e83-774a-43f4-8a6f-df10b3ba5751" />

<br />

[![MIT License](https://img.shields.io/badge/License-MIT-555555.svg?labelColor=333333&color=666666)](LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/generalaction/emdash?labelColor=333333&color=666666)](https://github.com/generalaction/emdash)
[![Last Commit](https://img.shields.io/github/last-commit/generalaction/emdash?labelColor=333333&color=666666)](https://github.com/generalaction/emdash/commits/main)
[![Commit Activity](https://img.shields.io/github/commit-activity/m/generalaction/emdash?labelColor=333333&color=666666)](https://github.com/generalaction/emdash/graphs/commit-activity)
[![Issues](https://img.shields.io/github/issues/generalaction/emdash?labelColor=333333&color=666666)](https://github.com/generalaction/emdash/issues)
[![Release](https://img.shields.io/github/v/release/generalaction/emdash?labelColor=333333&color=666666)](https://github.com/generalaction/emdash/releases)
[![Downloads](https://img.shields.io/github/downloads/generalaction/emdash/total?labelColor=333333&color=666666)](https://github.com/generalaction/emdash/releases)
<br>
[![Discord](https://img.shields.io/badge/Discord-join-%235462eb?labelColor=%235462eb&logo=discord&logoColor=%23f5f5f5)](https://discord.gg/Rm63cQaE)
[![Follow @emdashsh on X](https://img.shields.io/twitter/follow/emdashsh?logo=X&color=%23f5f5f5)](https://twitter.com/intent/follow?screen_name=emdashsh)

<br />

<div align="center" style="margin:24px 0;">

  <a href="https://github.com/generalaction/emdash/releases" style="display:inline-block; margin-right:24px; text-decoration:none; outline:none; border:none;">
    <img src="./docs/media/downloadformacos.png" alt="Download app for macOS" height="40">
  </a>

</div>

<br />

**Run multiple coding agents in parallel—provider-agnostic, worktree-isolated, and local-first.**

Emdash lets you develop and test multiple features with multiple agents in parallel. It’s provider-agnostic (we support 10+ CLIs, such as Claude Code and Codex) and runs each agent in its own Git worktree to keep changes clean; when the environment matters, you can run a PR in its own Docker container. Hand off Linear, GitHub, or Jira tickets to an agent, review diffs side-by-side, and keep everything local—your data never leaves your machine.


[Installation](#installation) • [Integrations](#integrations) • [Demo](#demo) • [Contributing](#contributing) • [FAQ](#faq)


## 🚀 Installation

**[Latest Release (macOS • Windows • Linux)](https://github.com/generalaction/emdash/releases/latest)**

<details><summary>Direct links</summary>

### macOS
- Apple Silicon: https://github.com/generalaction/emdash/releases/latest/download/emdash-arm64.dmg  
- Intel x64: https://github.com/generalaction/emdash/releases/latest/download/emdash-x64.dmg

[![Homebrew](https://img.shields.io/badge/-Homebrew-000000?style=for-the-badge&logo=homebrew&logoColor=FBB040)](https://formulae.brew.sh/cask/emdash)
> macOS users can also: `brew install --cask emdash`

### Windows
- Installer (x64): https://github.com/generalaction/emdash/releases/latest/download/emdash-x64-installer.exe  
- Portable (x64): https://github.com/generalaction/emdash/releases/latest/download/emdash-x64.exe

### Linux
- AppImage (x64): https://github.com/generalaction/emdash/releases/latest/download/emdash-x64.AppImage  
- Debian package (x64): https://github.com/generalaction/emdash/releases/latest/download/emdash-x64.deb
</details>

## 🔌 Integrations

<img width="4856" height="1000" alt="integration_banner" src="https://github.com/user-attachments/assets/894c3db8-3be5-4730-ae7d-197958b0a044" />



### Supported CLI Providers

Emdash currently integrates with eleven CLI providers and are adding new providers regularly. If you miss one, let us know or create a PR. 

| CLI Provider | Status | Install |
| ----------- | ------ | ----------- |
| [Codex](https://developers.openai.com/codex/cli/) | ✅ Supported | `npm install -g @openai/codex`. |
| [Amp](https://ampcode.com/manual) | ✅ Supported | `curl -fsSL https://ampcode.com/install.sh | bash` then run `amp`. |
| [Auggie (Augment Code)](https://docs.augmentcode.com/cli/overview) | ✅ Supported | `npm install -g @augmentcode/auggie`. |
| [Charm – Crush](https://github.com/charmbracelet/crush) | ✅ Supported | `go install github.com/charmbracelet/crush@latest`. |
| [Claude Code](https://www.npmjs.com/package/%40anthropic-ai/claude-code) | ✅ Supported | `npm install -g @anthropic-ai/claude-code`. |
| [Cursor CLI](https://cursor.com/cli) | ✅ Supported | `curl https://cursor.com/install -fsS | bash`. |
| [GitHub Copilot (CLI)](https://docs.github.com/en/copilot/how-tos/set-up/installing-github-copilot-in-the-cli) | ✅ Supported | `gh extension install github/gh-copilot`. |
| [OpenCode.ai](https://opencode.ai/docs/) | ✅ Supported | `npm install -g opencode-ai`. |
| [Droid (Factory)](https://docs.factory.ai/cli/getting-started/quickstart) | ✅ Supported | `curl -fsSL https://app.factory.ai/cli | sh` then run `droid`. |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | ✅ Supported | `npm install -g @google/gemini-cli`. |
| [Qwen Code](https://github.com/QwenLM/qwen-code) | ✅ Supported | `npm install -g @qwen-code/qwen-code`. |

### Issues

Emdash allows you to pass engineering tickets straight from your issue tracker to your coding agent at workspace creation. 

| Tool | Status | Authentication |
| ----------- | ------ | ----------- |
| [Linear](https://linear.app) | ✅ Supported | Connect with a Linear API key. |
| [Jira](https://www.atlassian.com/software/jira) | ✅ Supported | Provide your site URL, email, and Atlassian API token. |
| [GitHub Issues](https://docs.github.com/en/issues) | ✅ Supported | Authenticate via GitHub CLI (`gh auth login`). |

## 🖼️ Demo

#### Add an agents.md file
![Agents.md](https://github.com/user-attachments/assets/7426b97b-e073-4533-9a70-67bb39639517)
#### Run multiple agents in parallel

![Parallel agents](https://github.com/user-attachments/assets/ef20f7d6-73c7-4d00-9009-d4a95f5f6031)

#### Passing a Linear ticket

![Passing Linear](https://github.com/user-attachments/assets/027bf66f-9b04-48ba-aa0b-a85f0104ee71)


## 🛠️ Contributing

Contributions welcome! See the [Contributing Guide](CONTRIBUTING.md) to get started, and join our [Discord](https://discord.gg/YOUR_INVITE) to discuss.

## FAQ

<details>
<summary><b>What telemetry do you collect and can I disable it?</b></summary>

> We send **anonymous, allow‑listed events** (app start/close, feature usage names, app/platform versions) to PostHog.  
> We **do not** send code, file paths, repo names, prompts, or PII.
>
> **Disable telemetry:**
>
> - In the app: **Settings → General → Privacy & Telemetry** (toggle off)
> - Or via env var before launch:
>
> ```bash
> TELEMETRY_ENABLED=false
> ```
>
> Full details: see `docs/telemetry.md`.
</details>

<details>
<summary><b>Where is my data stored?</b></summary>

> Everything is **local‑first**. We store app state in a local **SQLite** database:
>
> ```
> macOS:  ~/Library/Application Support/emdash/emdash.db
> Windows: %APPDATA%/emdash/emdash.db
> Linux:  ~/.config/emdash/emdash.db
> ```
>
> You can reset by deleting the DB (quit the app first). The file is recreated on next launch.
</details>

<details>
<summary><b>Do I need GitHub CLI?</b></summary>

> **Only if you want GitHub features** (open PRs from Emdash, fetch repo info, GitHub Issues integration).  
> Install & sign in:
>
> ```bash
> gh auth login
> ```
>
> If you don’t use GitHub features, you can skip installing `gh`.
</details>

<details>
<summary><b>How do I add a new provider?</b></summary>

> Emdash is **provider‑agnostic** and built to add CLIs quickly.
>
> - Open a PR following the **Contributing Guide** (`CONTRIBUTING.md`).
> - Include: provider name, how it’s invoked (CLI command), auth notes, and minimal setup steps.
> - We’ll add it to the **Integrations** matrix and wire up provider selection in the UI.
>
> If you’re unsure where to start, open an issue with the CLI’s link and typical commands.
</details>

<details>
<summary><b>I hit a native‑module crash (sqlite3 / node‑pty / keytar). What’s the fast fix?</b></summary>

> This usually happens after switching Node/Electron versions.
>
> 1) Rebuild native modules:
>
> ```bash
> npm run rebuild
> ```
>
> 2) If that fails, clean and reinstall:
>
> ```bash
> npm run reset
> ```
>
> (Resets `node_modules`, reinstalls, and re‑builds Electron native deps.)
</details>

<details>
<summary><b>What permissions does Emdash need?</b></summary>

> - **Filesystem/Git:** to read/write your repo and create **Git worktrees** for isolation.  
> - **Network:** only for provider CLIs you choose to use (e.g., Codex, Claude) and optional GitHub actions.  
> - **Local DB:** to store your app state in SQLite on your machine.
>
> Emdash itself does **not** send your code or chats to our servers. Third‑party CLIs may transmit data per their policies.
</details>


