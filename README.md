# Scrawl

**An Open Source Agentic Writer Environment (AWE)**

[Website](https://agenticwriting.app/) · [Documentation](https://agenticwriting.app/docs) · [GitHub](https://github.com/gidea/scrawl)

[![MIT License](https://img.shields.io/badge/License-MIT-555555.svg?labelColor=333333&color=666666)](./LICENSE.md)

---

> **Attribution**: Scrawl is a fork of [Emdash](https://github.com/generalaction/emdash), an open-source Agentic Development Environment created by [General Action, Inc.](https://github.com/generalaction) We are grateful for their creativity and engineering — their work on parallel agent orchestration, worktree isolation, and provider-agnostic design made this project possible. Scrawl is a separate project maintained independently. No disrespect is intended to the original maintainers; we have been inspired by their vision to start this project.

> **On AI-assisted writing**: We are aware of the many risks that agentic writing produces in terms of AI slop. These are risks to mitigate through craft, editing, and intentional use — not risks to avoid. The best writing comes from writers who bring their own voice, knowledge, and standards to the work.

---

Scrawl is a provider-agnostic desktop app that lets you run multiple writing agents in parallel, each isolated in its own workspace, either locally or over SSH on a remote machine.

The same workspace and task-based workflows that developers use to orchestrate coding agents are available to writers — copywriters, content writers, proposal writers, and technical writers — who want to use any LLM to create written content with the same ease as having multiple agents working in parallel.

[Installation](#installation) · [Capabilities](#capabilities) · [Providers](#providers) · [Roadmap](#roadmap) · [Contributing](#contributing) · [FAQ](#faq)

## Capabilities

- **Any LLM** — Use any of 22+ CLI agents: Claude Code, Gemini, Qwen Code, Codex, and more
- **Parallel agents** — Run multiple agents on the same writing brief, compare their drafts, and pick the best
- **Isolated workspaces** — Each writing task gets its own git branch and worktree, keeping drafts separate
- **Diff view** — See exactly what changed between drafts, side by side
- **Kanban board** — Organize writing tasks visually across your workflow
- **Issue integration** — Pull briefs from Linear, Jira, or GitHub Issues directly
- **Skills** — Reusable prompt packages that work across agents
- **MCP support** — Connect to external data sources and tools via the Model Context Protocol
- **SSH remote** — Work on remote servers with the same parallel workflow as local projects
- **Local-first** — All app data stored in a local SQLite database on your machine

## Installation

### Build from source

```bash
# Clone the repo
git clone https://github.com/gidea/scrawl
cd scrawl

# Use the correct Node.js version (22.x required)
nvm use

# Install dependencies and start the dev server
pnpm run d
```

### Pre-built binaries

Pre-built binaries for macOS, Windows, and Linux are planned. Check the [releases page](https://github.com/gidea/scrawl/releases) for availability.

## Providers

Scrawl supports the same 22 CLI agents as Emdash. Any agent that works with Emdash works with Scrawl. Install at least one to get started.

| Provider | Install |
| ----------- | ----------- |
| [Amp](https://ampcode.com/manual) | `npm install -g @sourcegraph/amp@latest` |
| [Auggie](https://docs.augmentcode.com/cli/overview) | `npm install -g @augmentcode/auggie` |
| [Autohand Code](https://autohand.ai/code/) | `npm install -g autohand-cli` |
| [Charm](https://github.com/charmbracelet/crush) | `npm install -g @charmland/crush` |
| [Claude Code](https://docs.anthropic.com/claude/docs/claude-code) | `curl -fsSL https://claude.ai/install.sh \| bash` |
| [Cline](https://docs.cline.bot/cline-cli/overview) | `npm install -g cline` |
| [Codebuff](https://www.codebuff.com/docs/help/quick-start) | `npm install -g codebuff` |
| [Codex](https://developers.openai.com/codex/cli/) | `npm install -g @openai/codex` |
| [Continue](https://docs.continue.dev/guides/cli) | `npm i -g @continuedev/cli` |
| [Cursor](https://cursor.com/cli) | `curl https://cursor.com/install -fsS \| bash` |
| [Droid](https://docs.factory.ai/cli/getting-started/quickstart) | `curl -fsSL https://app.factory.ai/cli \| sh` |
| [Gemini](https://github.com/google-gemini/gemini-cli) | `npm install -g @google/gemini-cli` |
| [GitHub Copilot](https://docs.github.com/en/copilot/how-tos/set-up/installing-github-copilot-in-the-cli) | `npm install -g @github/copilot` |
| [Goose](https://github.com/block/goose) | `curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh \| bash` |
| [Kilocode](https://kilo.ai/docs/cli) | `npm install -g @kilocode/cli` |
| [Kimi](https://www.kimi.com/code/docs/en/kimi-cli/guides/getting-started.html) | `uv tool install --python 3.13 kimi-cli` |
| [Kiro](https://kiro.dev/docs/cli/) | `curl -fsSL https://cli.kiro.dev/install \| bash` |
| [Mistral Vibe](https://github.com/mistralai/mistral-vibe) | `curl -LsSf https://mistral.ai/vibe/install.sh \| bash` |
| [OpenCode](https://opencode.ai/docs/) | `npm install -g opencode-ai` |
| [Pi](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) | `npm install -g @mariozechner/pi-coding-agent` |
| [Qwen Code](https://github.com/QwenLM/qwen-code) | `npm install -g @qwen-code/qwen-code` |
| [Rovo Dev](https://support.atlassian.com/rovo/docs/install-and-run-rovo-dev-cli-on-your-device/) | `acli rovodev auth login` |

### Issue Trackers

| Tool | Authentication |
| ----------- | ----------- |
| [Linear](https://linear.app) | Connect with a Linear API key |
| [Jira](https://www.atlassian.com/software/jira) | Provide your site URL, email, and Atlassian API token |
| [GitHub Issues](https://docs.github.com/en/issues) | Authenticate via GitHub CLI (`gh auth login`) |

## Roadmap

Scrawl inherits a mature feature set from Emdash. Here is what we are building specifically for writers:

- **Cloud vector database integration** — Connect to vector databases via MCP for retrieval-augmented generation (RAG), enabling research-backed writing workflows
- **Writer-specific skills** — Reusable prompt packages for style guide enforcement, tone matching, audience adaptation, and format compliance
- **Content project templates** — Pre-configured project setups for common writing workflows (blog posts, proposals, technical docs, marketing copy)
- **Additional writer needs** — We are carefully considering what workflows writers need beyond what developers use. Community feedback will shape this

## Contributing

Contributions welcome! See the [Contributing Guide](CONTRIBUTING.md) to get started.

## FAQ

<details>
<summary><b>Is this the same as Emdash?</b></summary>

> No. Scrawl is a fork of [Emdash](https://github.com/generalaction/emdash), maintained independently. Emdash is an Agentic Development Environment for software developers. Scrawl takes the same core architecture — parallel agent orchestration, worktree isolation, provider-agnostic design — and repositions it as an Agentic Writer Environment for people who create written content. We credit the Emdash team for the foundation this project builds on.
</details>

<details>
<summary><b>Will my writing be sent to AI providers?</b></summary>

> Scrawl itself stores all data locally and does not send your content to any servers. However, when you use any CLI agent (Claude Code, Codex, Gemini, etc.), your content and prompts are sent to that provider's cloud API for processing. Each provider has their own data handling and retention policies. Review your chosen provider's privacy policy before sending sensitive content.
</details>

<details>
<summary><b>What telemetry do you collect and can I disable it?</b></summary>

> We send **anonymous, allow-listed events** (app start/close, feature usage names, app/platform versions) to PostHog.
> We **do not** send content, file paths, project names, prompts, or PII.
>
> **Disable telemetry:**
>
> - In the app: **Settings > General > Privacy & Telemetry** (toggle off)
> - Or via env var before launch:
>
> ```bash
> TELEMETRY_ENABLED=false
> ```
</details>

<details>
<summary><b>Where is my data stored?</b></summary>

> App data is local-first. We store app state in a local SQLite database:
>
> ```
> macOS:   ~/Library/Application Support/emdash/emdash.db
> Windows: %APPDATA%\emdash\emdash.db
> Linux:   ~/.config/emdash/emdash.db
> ```
>
> Note: The database paths still use the `emdash` directory name from the upstream project. This may change in a future release.
</details>

<details>
<summary><b>Do I need GitHub CLI?</b></summary>

> Only if you want GitHub features (open PRs, fetch repo info, GitHub Issues integration).
> Install and sign in:
>
> ```bash
> gh auth login
> ```
>
> If you don't use GitHub features, you can skip installing `gh`.
</details>

<details>
<summary><b>I hit a native-module crash (sqlite3 / node-pty / keytar). What's the fast fix?</b></summary>

> This usually happens after switching Node/Electron versions.
>
> 1. Rebuild native modules:
>
> ```bash
> pnpm run rebuild
> ```
>
> 2. If that fails, clean and reinstall:
>
> ```bash
> pnpm run reset
> ```
</details>

<details>
<summary><b>Can I work with remote projects over SSH?</b></summary>

> Yes. Scrawl supports remote development via SSH.
>
> 1. Go to **Settings > SSH Connections** and add your server details
> 2. Choose authentication: SSH agent (recommended), private key, or password
> 3. Add a remote project and specify the path on the server
>
> See [docs/ssh-setup.md](./docs/ssh-setup.md) for detailed setup instructions.
</details>
