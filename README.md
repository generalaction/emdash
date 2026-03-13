<div align="center">

# Scrawl

**An Agentic Writer Environment (AWE)**

[![MIT License](https://img.shields.io/badge/License-MIT-555555.svg?labelColor=333333&color=666666)](./LICENSE.md)
[![Downloads](https://img.shields.io/github/downloads/gidea/scrawl/total?labelColor=333333&color=666666)](https://github.com/gidea/scrawl/releases)
[![GitHub Stars](https://img.shields.io/github/stars/gidea/scrawl?labelColor=333333&color=666666)](https://github.com/gidea/scrawl)
[![Last Commit](https://img.shields.io/github/last-commit/gidea/scrawl?labelColor=333333&color=666666)](https://github.com/gidea/scrawl/commits/main)

<br />

  <a href="https://github.com/gidea/scrawl/releases" style="display:inline-block; margin-right:8px; text-decoration:none; outline:none; border:none;">
    <img src="./docs/public/media/downloadforwindows.png" alt="Download for Windows" height="40">
  </a>
  <a href="https://github.com/gidea/scrawl/releases" style="display:inline-block; margin-right:8px; text-decoration:none; outline:none; border:none;">
    <img src="./docs/public/media/downloadformacos.png" alt="Download for macOS" height="40">
  </a>
  <a href="https://github.com/gidea/scrawl/releases" style="display:inline-block; text-decoration:none; outline:none; border:none;">
    <img src="./docs/public/media/downloadforlinux.png" alt="Download for Linux" height="40">
  </a>

</div>

<br />

Scrawl is a provider-agnostic desktop app that lets writers run multiple AI agents in parallel, each working in its own isolated Git worktree — locally or over SSH. We call it an **Agentic Writer Environment (AWE)**.

The same parallel, isolated, reviewable workflow that developers use with coding agents — applied to written content. Copywriters, content writers, proposal writers, and technical writers can orchestrate multiple agents on the same brief, compare drafts side-by-side, iterate, and publish — with humans staying meaningfully in the loop throughout.

Scrawl supports 22+ CLI agents, including Claude Code, Gemini, Qwen Code, and Codex. Pass writing briefs directly from Linear, GitHub Issues, or Jira; review diffs between drafts; and manage your content pipeline on a Kanban board.

> **A note on AI-generated content quality.** Agentic writing carries real risks — generic output, voice homogenization, factual errors, and the erosion of distinct authorial voice. We are aware of these. Our answer is not to avoid agentic writing, but to build tools that keep humans meaningfully in the loop: Best-of-N draft comparison, structured diff review before publishing, style guide enforcement via skills, and source attribution in RAG workflows. The goal is augmented writers, not replaced ones.

---

> **Attribution.** Scrawl is a fork of [Emdash](https://github.com/generalaction/emdash), an Agentic Development Environment built by the team at [generalaction](https://github.com/generalaction). We mean no disrespect to the original maintainers — Emdash's architecture, worktree isolation model, and multi-agent orchestration were the direct inspiration for this project. We are grateful for their creativity and open source work. Scrawl takes that foundation and repositions it for a different audience: writers who want the same parallel, isolated, reviewable workflow for written content.

---

<div align="center">

[Installation](#installation) • [Agents](#agents) • [Briefs & Tickets](#briefs--tickets) • [Contributing](#contributing) • [FAQ](#faq)

</div>

<img alt="Scrawl product" src="./docs/public/media/product.jpeg" />

# Installation

### macOS
- Apple Silicon: https://github.com/gidea/scrawl/releases/latest/download/scrawl-arm64.dmg
- Intel x64: https://github.com/gidea/scrawl/releases/latest/download/scrawl-x64.dmg

### Windows
- Installer (x64): https://github.com/gidea/scrawl/releases/latest/download/scrawl-x64.msi
- Portable (x64): https://github.com/gidea/scrawl/releases/latest/download/scrawl-x64.exe

### Linux
- AppImage (x64): https://github.com/gidea/scrawl/releases/latest/download/scrawl-x86_64.AppImage
- Debian package (x64): https://github.com/gidea/scrawl/releases/latest/download/scrawl-amd64.deb

### Release Overview

**[Latest Releases (macOS • Windows • Linux)](https://github.com/gidea/scrawl/releases/latest)**

# Agents

Scrawl is provider-agnostic — it works with any CLI agent you already have installed. Agents are detected automatically; no configuration required.

### Supported CLI Agents

| CLI Agent | Install |
| --------- | ------- |
| [Claude Code](https://docs.anthropic.com/claude/docs/claude-code) | <code>curl -fsSL https://claude.ai/install.sh &#124; bash</code> |
| [Codex](https://developers.openai.com/codex/cli/) | <code>npm install -g @openai/codex</code> |
| [Gemini](https://github.com/google-gemini/gemini-cli) | <code>npm install -g @google/gemini-cli</code> |
| [Qwen Code](https://github.com/QwenLM/qwen-code) | <code>npm install -g @qwen-code/qwen-code</code> |
| [Amp](https://ampcode.com/manual) | <code>npm install -g @sourcegraph/amp@latest</code> |
| [Auggie](https://docs.augmentcode.com/cli/overview) | <code>npm install -g @augmentcode/auggie</code> |
| [Autohand Code](https://autohand.ai/code/) | <code>npm install -g autohand-cli</code> |
| [Charm](https://github.com/charmbracelet/crush) | <code>npm install -g @charmland/crush</code> |
| [Cline](https://docs.cline.bot/cline-cli/overview) | <code>npm install -g cline</code> |
| [Codebuff](https://www.codebuff.com/docs/help/quick-start) | <code>npm install -g codebuff</code> |
| [Continue](https://docs.continue.dev/guides/cli) | <code>npm i -g @continuedev/cli</code> |
| [Cursor](https://cursor.com/cli) | <code>curl https://cursor.com/install -fsS &#124; bash</code> |
| [Droid](https://docs.factory.ai/cli/getting-started/quickstart) | <code>curl -fsSL https://app.factory.ai/cli &#124; sh</code> |
| [GitHub Copilot](https://docs.github.com/en/copilot/how-tos/set-up/installing-github-copilot-in-the-cli) | <code>npm install -g @github/copilot</code> |
| [Goose](https://github.com/block/goose) | <code>curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh &#124; bash</code> |
| [Kilocode](https://kilo.ai/docs/cli) | <code>npm install -g @kilocode/cli</code> |
| [Kimi](https://www.kimi.com/code/docs/en/kimi-cli/guides/getting-started.html) | <code>uv tool install --python 3.13 kimi-cli</code> |
| [Kiro](https://kiro.dev/docs/cli/) | <code>curl -fsSL https://cli.kiro.dev/install &#124; bash</code> |
| [Mistral Vibe](https://github.com/mistralai/mistral-vibe) | <code>curl -LsSf https://mistral.ai/vibe/install.sh &#124; bash</code> |
| [OpenCode](https://opencode.ai/docs/) | <code>npm install -g opencode-ai</code> |
| [Pi](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) | <code>npm install -g @mariozechner/pi-coding-agent</code> |
| [Rovo Dev](https://support.atlassian.com/rovo/docs/install-and-run-rovo-dev-cli-on-your-device/) | <code>acli rovodev auth login</code> |

# Briefs & Tickets

Scrawl lets you pass content briefs and writing tickets straight from your project management tools to an agent.

| Tool | Authentication |
| ---- | -------------- |
| [Linear](https://linear.app) | Connect with a Linear API key |
| [Jira](https://www.atlassian.com/software/jira) | Provide your site URL, email, and Atlassian API token |
| [GitHub Issues](https://docs.github.com/en/issues) | Authenticate via GitHub CLI (`gh auth login`) |

**Develop on remote servers via SSH**

Connect to remote machines via SSH/SFTP to work with remote content repositories. Scrawl supports SSH agent and key authentication, with secure credential storage in your OS keychain. Run agents on remote projects using the same parallel workflow as local writing.

# Contributing

Contributions welcome! See the [Contributing Guide](CONTRIBUTING.md) to get started.

# FAQ

<details>
<summary><b>What is an Agentic Writer Environment?</b></summary>

> An AWE is a workspace where multiple AI writing agents run in parallel, each in an isolated environment, and a human reviewer controls what gets merged. Think of it like a writing room where each agent takes a different angle on the same brief — you compare the drafts, pick what works, and iterate.
>
> The key principles:
> - **Isolation**: each agent works on its own branch, so drafts don't interfere with each other
> - **Comparison**: Best-of-N mode lets you run the same brief across multiple agents and compare results
> - **Human review**: diffs are always human-reviewable before anything is published or merged
> - **Augmentation, not replacement**: the writer sets the brief, reviews the output, and makes the final call

</details>

<details>
<summary><b>What about AI slop — won't this just produce generic content?</b></summary>

> That's a real risk and one we take seriously. Agentic writing can produce generic, homogenized, or factually wrong output. We're building Scrawl to mitigate this, not ignore it:
>
> - **Best-of-N comparison** — run multiple agents and pick the draft with the strongest voice
> - **Diff review** — every change is visible before it lands; nothing gets merged silently
> - **Skills for style enforcement** — install a skill that encodes your house style, tone guidelines, or audience profile; agents apply it on every run
> - **RAG with source attribution** — planned: agents cite sources when drawing on retrieved content
>
> The goal is a workflow where the writer's judgment remains central. Agents draft; writers decide.

</details>

<details>
<summary><b>What telemetry do you collect and can I disable it?</b></summary>

> We send **anonymous, allow-listed events** (app start/close, feature usage names, app/platform versions) to PostHog.
> We **do not** send content, file paths, repo names, prompts, or PII.
>
> **Disable telemetry:**
>
> - In the app: **Settings → General → Privacy & Telemetry** (toggle off)
> - Or via env var before launch:
>
> ```bash
> TELEMETRY_ENABLED=false
> ```

</details>

<details>
<summary><b>Where is my data stored?</b></summary>

> **App data is local-first.** We store app state in a local **SQLite** database:
>
> ```
> macOS:   ~/Library/Application Support/emdash/emdash.db
> Windows: %APPDATA%\emdash\emdash.db
> Linux:   ~/.config/emdash/emdash.db
> ```
>
> **Privacy note:** While Scrawl itself stores data locally, **when you use any agent (Claude Code, Codex, Gemini, etc.), your content and prompts are sent to that provider's cloud API servers** for processing. Each provider has their own data handling and retention policies.
>
> You can reset the local DB by deleting it (quit the app first). The file is recreated on next launch.

</details>

<details>
<summary><b>Do I need GitHub CLI?</b></summary>

> **Only if you want GitHub features** (open PRs from Scrawl, fetch repo info, GitHub Issues integration).
>
> ```bash
> gh auth login
> ```
>
> If you don't use GitHub features, you can skip installing `gh`.

</details>

<details>
<summary><b>How do I add a new agent?</b></summary>

> Scrawl is **provider-agnostic** and built to add CLI agents quickly.
>
> - Open a PR following the **Contributing Guide** (`CONTRIBUTING.md`).
> - Include: agent name, CLI command, auth notes, and minimal setup steps.
> - We'll add it to the supported agents table and wire up provider selection in the UI.
>
> If you're unsure where to start, open an issue with the CLI's link and typical commands.

</details>

<details>
<summary><b>I hit a native-module crash (sqlite3 / node-pty / keytar). What's the fast fix?</b></summary>

> This usually happens after switching Node/Electron versions.
>
> 1) Rebuild native modules:
>
> ```bash
> pnpm run rebuild
> ```
>
> 2) If that fails, clean and reinstall:
>
> ```bash
> pnpm run reset
> ```

</details>

<details>
<summary><b>What permissions does Scrawl need?</b></summary>

> - **Filesystem/Git:** to read/write your content repo and create **Git worktrees** for isolation.
> - **Network:** only for the agent CLIs you choose to use and optional GitHub actions.
> - **Local DB:** to store your app state in SQLite on your machine.
>
> Scrawl itself does **not** send your content or chats to any servers. Third-party agent CLIs may transmit data per their policies.

</details>

<details>
<summary><b>Can I work with remote projects over SSH?</b></summary>

> **Yes.** Scrawl supports remote development via SSH.
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
> See [docs/ssh-setup.md](./docs/ssh-setup.md) for detailed setup instructions.

</details>
