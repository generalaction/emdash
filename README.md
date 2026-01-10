<img width="4856" height="1000" alt="Github_banner (1)" src="https://github.com/user-attachments/assets/9dfdd1fd-ea4f-4b86-9daf-d4a46952594a" />

<div align="center" style="margin:24px 0;">
  
<br />

[![MIT License](https://img.shields.io/badge/License-MIT-555555.svg?labelColor=333333&color=666666)](LICENSE)
[![Downloads](https://img.shields.io/github/downloads/generalaction/emdash/total?labelColor=333333&color=666666)](https://github.com/generalaction/emdash/releases)
[![GitHub Stars](https://img.shields.io/github/stars/generalaction/emdash?labelColor=333333&color=666666)](https://github.com/generalaction/emdash)
[![Last Commit](https://img.shields.io/github/last-commit/generalaction/emdash?labelColor=333333&color=666666)](https://github.com/generalaction/emdash/commits/main)
[![Commit Activity](https://img.shields.io/github/commit-activity/m/generalaction/emdash?labelColor=333333&color=666666)](https://github.com/generalaction/emdash/graphs/commit-activity)
<br>
[![Discord](https://img.shields.io/badge/Discord-join-%235462eb?labelColor=%235462eb&logo=discord&logoColor=%23f5f5f5)](https://discord.gg/f2fv7YxuR2)
<a href="https://www.ycombinator.com"><img src="https://img.shields.io/badge/Y%20Combinator-W26-orange" alt="Y Combinator W26"></a>
[![Follow @emdashsh on X](https://img.shields.io/twitter/follow/emdashsh?logo=X&color=%23f5f5f5)](https://twitter.com/intent/follow?screen_name=emdashsh)

<br />

  <a href="https://github.com/generalaction/emdash/releases" style="display:inline-block; margin-right:24px; text-decoration:none; outline:none; border:none;">
    <img src="./docs/public/media/downloadformacos.png" alt="Download app for macOS" height="40">
  </a>

</div>

<br />

**Run multiple coding agents in parallel**

Emdash lets you develop and test multiple features with multiple agents in parallel. It’s provider-agnostic (supports 15+ CLI agents, such as Claude Code, Qwen Code, Amp, and Codex) and runs each agent in its own Git worktree to keep changes clean; Hand off Linear, GitHub, or Jira tickets to an agent and review diffs side-by-side.

<div align="center" style="margin:24px 0;">

[Installation](#installation) • [Integrations](#integrations) • [Contributing](#contributing) • [FAQ](#faq)

</div>

# Installation

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

# Providers

<img width="4856" height="1000" alt="integration_banner" src="https://github.com/user-attachments/assets/894c3db8-3be5-4730-ae7d-197958b0a044" />

### Supported CLI Providers

Emdash currently supports fifteen CLI providers and we are adding new providers regularly. If you miss one, let us know or create a PR. 

| CLI Provider | Status | Install |
| ----------- | ------ | ----------- |
| [Codex](https://developers.openai.com/codex/cli/) | ✅ Supported | `npm install -g @openai/codex` |
| [Amp](https://ampcode.com/manual) | ✅ Supported | `npm install -g @sourcegraph/amp@latest` |
| [Auggie](https://docs.augmentcode.com/cli/overview) | ✅ Supported | `npm install -g @augmentcode/auggie` |
| [Charm](https://github.com/charmbracelet/crush) | ✅ Supported | `npm install -g @charmland/crush` |
| [Claude Code](https://www.npmjs.com/package/%40anthropic-ai/claude-code) | ✅ Supported | `npm install -g @anthropic-ai/claude-code` |
| [Cursor](https://cursor.com/cli) | ✅ Supported | `curl https://cursor.com/install -fsS | bash` |
| [Droid](https://docs.factory.ai/cli/getting-started/quickstart) | ✅ Supported | `curl -fsSL https://app.factory.ai/cli | sh` |
| [Gemini](https://github.com/google-gemini/gemini-cli) | ✅ Supported | `npm install -g @google/gemini-cli` |
| [GitHub Copilot](https://docs.github.com/en/copilot/how-tos/set-up/installing-github-copilot-in-the-cli) | ✅ Supported | `npm install -g @github/copilot` |
| [Goose](https://github.com/block/goose) | ✅ Supported | `curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | bash` |
| [OpenCode](https://opencode.ai/docs/) | ✅ Supported | `npm install -g opencode-ai` |
| [Qwen Code](https://github.com/QwenLM/qwen-code) | ✅ Supported | `npm install -g @qwen-code/qwen-code` |
| [Kimi](https://www.kimi.com/coding/docs/en/kimi-cli.html) | ✅ Supported | `uv tool install --python 3.13 kimi-cli` |
| [Kiro](https://kiro.dev/docs/cli/) | ✅ Supported | `curl -fsSL https://cli.kiro.dev/install | bash` |
| [Rovo Dev](https://support.atlassian.com/rovo/docs/install-and-run-rovo-dev-cli-on-your-device/) | ✅ Supported | `acli rovodev auth login` |

### Issues

Emdash allows you to pass tickets straight from Linear, GitHub, or Jira to your coding agent. 

| Tool | Status | Authentication |
| ----------- | ------ | ----------- |
| [Linear](https://linear.app) | ✅ Supported | Connect with a Linear API key. |
| [Jira](https://www.atlassian.com/software/jira) | ✅ Supported | Provide your site URL, email, and Atlassian API token. |
| [GitHub Issues](https://docs.github.com/en/issues) | ✅ Supported | Authenticate via GitHub CLI (`gh auth login`). |

# Contributing

Contributions welcome! See the [Contributing Guide](CONTRIBUTING.md) to get started, and join our [Discord](https://discord.gg/f2fv7YxuR2) to discuss.

# FAQ

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

> **App data is local‑first**. We store app state in a local **SQLite** database:
>
> ```
> macOS:  ~/Library/Application Support/emdash/emdash.db
> Windows: %APPDATA%/emdash/emdash.db
> Linux:  ~/.config/emdash/emdash.db
> ```
>
> **Privacy Note:** While Emdash itself stores data locally, **when you use any coding agent (Claude Code, Codex, Qwen, etc.), your code and prompts are sent to that provider's cloud API servers** for processing. Each provider has their own data handling and retention policies.
>
> You can reset the local DB by deleting it (quit the app first). The file is recreated on next launch.
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
> Emdash itself does **not** send your code or chats to any servers. Third‑party CLIs may transmit data per their policies.
</details>

[![Follow @rabanspiegel](https://img.shields.io/twitter/follow/rabanspiegel?style=social&label=Follow%20%40rabanspiegel)](https://x.com/rabanspiegel)
[![Follow @arnestrickmann](https://img.shields.io/twitter/follow/arnestrickmann?style=social&label=Follow%20%40arnestrickmann)](https://x.com/arnestrickmann)

