<img alt="Emdash banner" src="https://github.com/user-attachments/assets/a2ecaf3c-9d84-40ca-9a8e-d4f612cc1c6f" />


<div align="center" style="margin:24px 0;">
  
<br />

[![MIT License](https://img.shields.io/badge/License-MIT-555555.svg?labelColor=333333&color=666666)](./LICENSE.md)
[![Downloads](https://img.shields.io/github/downloads/generalaction/emdash/total?labelColor=333333&color=666666)](https://github.com/generalaction/emdash/releases)
[![GitHub Stars](https://img.shields.io/github/stars/generalaction/emdash?labelColor=333333&color=666666)](https://github.com/generalaction/emdash)
[![Last Commit](https://img.shields.io/github/last-commit/generalaction/emdash?labelColor=333333&color=666666)](https://github.com/generalaction/emdash/commits/main)
[![Commit Activity](https://img.shields.io/github/commit-activity/m/generalaction/emdash?labelColor=333333&color=666666)](https://github.com/generalaction/emdash/graphs/commit-activity)
<br>
[![Discord](https://img.shields.io/badge/Discord-join-%235462eb?labelColor=%235462eb&logo=discord&logoColor=%23f5f5f5)](https://discord.gg/f2fv7YxuR2)
<a href="https://www.ycombinator.com"><img src="https://img.shields.io/badge/Y%20Combinator-W26-orange" alt="Y Combinator W26"></a>
[![Follow @emdashsh on X](https://img.shields.io/twitter/follow/emdashsh?logo=X&color=%23f5f5f5)](https://twitter.com/intent/follow?screen_name=emdashsh)

<br />

  <a href="https://github.com/generalaction/emdash/releases" style="display:inline-block; margin-right:8px; text-decoration:none; outline:none; border:none;">
    <img src="./docs/public/media/downloadforwindows.png" alt="Download for Windows" height="40">
  </a>
  <a href="https://github.com/generalaction/emdash/releases" style="display:inline-block; margin-right:8px; text-decoration:none; outline:none; border:none;">
    <img src="./docs/public/media/downloadformacos.png" alt="Download for macOS" height="40">
  </a>
  <a href="https://github.com/generalaction/emdash/releases" style="display:inline-block; text-decoration:none; outline:none; border:none;">
    <img src="./docs/public/media/downloadforlinux.png" alt="Download for Linux" height="40">
  </a>

</div>

<br />

Emdash is a provider-agnostic desktop app that lets you run multiple coding agents in parallel, each isolated in its own git worktree, either locally or over SSH on a remote machine. We call it an Agentic Development Environment (ADE).

Emdash supports 21 (and growing) CLI agents, such as Claude Code, Qwen Code, Amp, and Codex. Users can directly pass Linear, GitHub, or Jira tickets to an agent, review diffs, test changes, create PRs, see CI/CD checks, and merge. 

**Develop on remote servers via SSH**

Connect to remote machines via SSH/SFTP to work with remote codebases. Emdash supports SSH agent and key authentication, with secure credential storage in your OS keychain. Run agents on remote projects using the same parallel workflow as local development. [Learn more](https://www.emdash.sh/cloud)

<div align="center" style="margin:24px 0;">

[Installation](#installation) • [Providers](#providers) • [Contributing](#contributing) • [FAQ](#faq)

</div>

<img alt="Emdash product" src="./docs/public/media/product.jpeg" />

# Installation

### macOS
- Apple Silicon: https://github.com/generalaction/emdash/releases/latest/download/emdash-arm64.dmg
- Intel x64: https://github.com/generalaction/emdash/releases/latest/download/emdash-x64.dmg

[![Homebrew](https://img.shields.io/badge/-Homebrew-000000?style=for-the-badge&logo=homebrew&logoColor=FBB040)](https://formulae.brew.sh/cask/emdash)
> macOS users can also: `brew install --cask emdash`

### Windows
- Installer (x64): https://github.com/generalaction/emdash/releases/latest/download/emdash-x64.msi
- Portable (x64): https://github.com/generalaction/emdash/releases/latest/download/emdash-x64.exe

### Linux
- AppImage (x64): https://github.com/generalaction/emdash/releases/latest/download/emdash-x86_64.AppImage
- Debian package (x64): https://github.com/generalaction/emdash/releases/latest/download/emdash-amd64.deb

### Release Overview

**[Latest Releases (macOS • Windows • Linux)](https://github.com/generalaction/emdash/releases/latest)**

# Providers

<img alt="Providers banner" src="https://github.com/user-attachments/assets/c7b32a3e-452c-4209-91ef-71bcd895e2df" />

### Supported CLI Providers

Emdash currently supports twenty-one CLI providers and we are adding new providers regularly. If you miss one, let us know or create a PR.

| CLI Provider | Status | Install |
| ----------- | ------ | ----------- |
| [Amp](https://ampcode.com/manual) | ✅ Supported | <code>npm install -g @sourcegraph/amp@latest</code> |
| [Auggie](https://docs.augmentcode.com/cli/overview) | ✅ Supported | <code>npm install -g @augmentcode/auggie</code> |
| [Charm](https://github.com/charmbracelet/crush) | ✅ Supported | <code>npm install -g @charmland/crush</code> |
| [Claude Code](https://docs.anthropic.com/claude/docs/claude-code) | ✅ Supported | <code>curl -fsSL https://claude.ai/install.sh &#124; bash</code> |
| [Cline](https://docs.cline.bot/cline-cli/overview) | ✅ Supported | <code>npm install -g cline</code> |
| [Codebuff](https://www.codebuff.com/docs/help/quick-start) | ✅ Supported | <code>npm install -g codebuff</code> |
| [Codex](https://developers.openai.com/codex/cli/) | ✅ Supported | <code>npm install -g @openai/codex</code> |
| [Continue](https://docs.continue.dev/guides/cli) | ✅ Supported | <code>npm i -g @continuedev/cli</code> |
| [Cursor](https://cursor.com/cli) | ✅ Supported | <code>curl https://cursor.com/install -fsS &#124; bash</code> |
| [Droid](https://docs.factory.ai/cli/getting-started/quickstart) | ✅ Supported | <code>curl -fsSL https://app.factory.ai/cli &#124; sh</code> |
| [Gemini](https://github.com/google-gemini/gemini-cli) | ✅ Supported | <code>npm install -g @google/gemini-cli</code> |
| [GitHub Copilot](https://docs.github.com/en/copilot/how-tos/set-up/installing-github-copilot-in-the-cli) | ✅ Supported | <code>npm install -g @github/copilot</code> |
| [Goose](https://github.com/block/goose) | ✅ Supported | <code>curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh &#124; bash</code> |
| [Kilocode](https://kilo.ai/docs/cli) | ✅ Supported | <code>npm install -g @kilocode/cli</code> |
| [Kimi](https://www.kimi.com/code/docs/en/kimi-cli/guides/getting-started.html) | ✅ Supported | <code>uv tool install --python 3.13 kimi-cli</code> |
| [Kiro](https://kiro.dev/docs/cli/) | ✅ Supported | <code>curl -fsSL https://cli.kiro.dev/install &#124; bash</code> |
| [Mistral Vibe](https://github.com/mistralai/mistral-vibe) | ✅ Supported | <code>curl -LsSf https://mistral.ai/vibe/install.sh &#124; bash</code> |
| [OpenCode](https://opencode.ai/docs/) | ✅ Supported | <code>npm install -g opencode-ai</code> |
| [Pi](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) | ✅ Supported | <code>npm install -g @mariozechner/pi-coding-agent</code> |
| [Qwen Code](https://github.com/QwenLM/qwen-code) | ✅ Supported | <code>npm install -g @qwen-code/qwen-code</code> |
| [Rovo Dev](https://support.atlassian.com/rovo/docs/install-and-run-rovo-dev-cli-on-your-device/) | ✅ Supported | <code>acli rovodev auth login</code> |

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
> macOS:   ~/Library/Application Support/emdash/emdash.db
> Windows: %APPDATA%\emdash\emdash.db
> Linux:   ~/.config/emdash/emdash.db
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


<details>
<summary><b>Can I work with remote projects over SSH?</b></summary>

> **Yes!** Emdash supports remote development via SSH.
>
> **Setup:**
> 1. Go to **Settings → SSH Connections** and add your server details
> 2. Choose authentication: SSH agent (recommended), private key, or password
> 3. Add a remote project and specify the path on the server
>
> **Requirements:**
> - SSH access to the remote server
> - Git installed on the remote server
> - For agent auth: SSH agent running with your key loaded (`ssh-add -l`)
>
> See [docs/ssh-setup.md](./docs/ssh-setup.md) for detailed setup instructions and [docs/ssh-architecture.md](./docs/ssh-architecture.md) for technical details.
</details>

[![Follow @emdashsh](https://img.shields.io/twitter/follow/emdashsh?style=social&label=Follow%20%40emdashsh)](https://x.com/emdashsh)
[![Follow @rabanspiegel](https://img.shields.io/twitter/follow/rabanspiegel?style=social&label=Follow%20%40rabanspiegel)](https://x.com/rabanspiegel)
[![Follow @arnestrickmann](https://img.shields.io/twitter/follow/arnestrickmann?style=social&label=Follow%20%40arnestrickmann)](https://x.com/arnestrickmann)
