<p align="center">
    <img src="./src/assets/images/emdash/emdash_logo.svg#gh-light-mode-only"
  alt="Emdash X" width="900">
    <img src="./src/assets/images/emdash/emdash_logo_white.svg#gh-dark-mode-only"
  alt="Emdash X" width="900">
  </p>

# Emdash X - Next-Generation Agent Orchestration with Jujutsu

> [!CAUTION]
> ## ⚠️ HIGHLY EXPERIMENTAL - DO NOT USE YET ⚠️
> 
> **This is an early experimental fork with minimal implementation.** Most Jujutsu integration and experimental features described below are **not yet implemented**. This repository currently serves as:
> - A vision document for future development
> - A testbed for experimental ideas
> - A discussion starter for the community
> 
> **Current Status:** 🔴 **Pre-Alpha** - Concept & Planning Phase
> 
> If you're looking for a working solution, please use the original [Emdash](https://github.com/generalaction/emdash) for now.

---

**Emdash X** is an experimental fork of [Emdash](https://github.com/generalaction/emdash), created by [@gunta](https://github.com/gunta). This fork revolutionizes parallel agent orchestration by replacing Git worktrees with **Jujutsu (jj) worktrees**, offering superior performance, safety, and workflow efficiency for running multiple coding agents simultaneously.

## 🚀 Why Jujutsu? The Evolution Beyond Git

Jujutsu is a modern VCS that provides a fundamentally better foundation for parallel agent workflows. **Created by a Google engineer and used internally at Google**, Jujutsu represents the state-of-the-art in version control systems. It has been **praised by Mitchell Hashimoto** (creator of Terraform, Vagrant, and Ghostty) as a revolutionary approach to version control.

Based on insights from [Parallel Claude Code with Jujutsu](https://slavakurilyak.com/posts/parallel-claude-code-with-jujutsu/), here's why Jujutsu is the perfect match for multi-agent orchestration:

### Comparison: Jujutsu vs Git for Agent Orchestration

| Feature | **Jujutsu (jj)** | **Git** | **Impact on Agent Workflows** |
|---------|------------------|---------|-------------------------------|
| **Automatic Commits** | ✅ Every operation auto-commits | ❌ Manual commits required | Agents never lose work; every change is instantly versioned |
| **Concurrent Operations** | ✅ Lock-free, truly parallel | ⚠️ File locks cause conflicts | Multiple agents can work simultaneously without blocking |
| **Conflict Resolution** | ✅ First-class conflicts in commits | ❌ Blocks operations | Agents can continue working even with conflicts |
| **Undo/Redo** | ✅ Native operation-level undo | ❌ Complex, risky | Agents can safely experiment and backtrack |
| **Working Directory** | ✅ Snapshots, no staging area | ❌ Requires staging | Simpler mental model for agents |
| **Branch Management** | ✅ Anonymous branches, lazy naming | ❌ Branches required upfront | Agents can explore without branch planning |
| **History Editing** | ✅ Safe, immutable operations | ⚠️ Dangerous rewrites | Agents can restructure work without data loss |
| **Performance** | ✅ Faster operations, better scaling | ⚠️ Slower with many worktrees | Handle more agents with less overhead |

### 🎯 Key Advantages for Parallel Agent Execution

#### 1. **No More Lost Work**
```bash
# Git: Agent might forget to commit
git add . && git commit -m "fix"  # Manual, error-prone

# Jujutsu: Automatic snapshots
jj status  # Everything already committed!
```

#### 2. **True Parallel Execution**
```bash
# Git: Worktrees can conflict
Agent1: git checkout -b feature1  # Might lock files
Agent2: git checkout -b feature2  # Could fail

# Jujutsu: Lock-free concurrency
Agent1: jj new  # Works instantly
Agent2: jj new  # No conflicts ever
```

#### 3. **Fearless Experimentation**
```bash
# Git: Dangerous to experiment
git reset --hard HEAD~3  # Data loss risk!

# Jujutsu: Safe exploration
jj undo  # Revert any operation
jj op log  # See complete history
```

#### 4. **Intelligent Conflict Handling**
```bash
# Git: Conflicts block everything
error: Your local changes would be overwritten

# Jujutsu: Work continues with conflicts
jj rebase -d main  # Conflicts become part of history
jj resolve  # Fix when convenient
```



## 🧪 Experimental Features & Roadmap

Emdash X is a testbed for next-generation agent orchestration features:

### Currently Implementing
- **[Beads](https://github.com/steveyegge/beads)** - Memory upgrade for coding agents with issue tracking
- **[cc-sdd](https://github.com/gotalab/cc-sdd)** - Structured task decomposition for Claude Code
- **Native Jujutsu UI** - Visual operation history and conflict resolution
- **Agent Memory Persistence** - Share context between agent sessions

### Planned Experiments
- **Multi-Model Consensus** - Run same task on multiple models, merge best solutions
- **Automatic Conflict Resolution** - AI-powered merge conflict solver
- **Time-Travel Debugging** - Replay agent decisions with different parameters
- **Distributed Agent Networks** - Agents across multiple machines via Jujutsu's Git compatibility

<hr style="border:0; height:1px; background:#d0d7de; margin:24px 0;">

<div align="center" style="margin:24px 0;">
  <a href="https://discord.gg/meqK3A5b" style="display:inline-block; margin-right:24px; text-decoration:none; outline:none; border:none;">
    <img src="https://img.shields.io/badge/Discord-%235865F2.svg?logo=discord&logoColor=white" alt="Join the Emdash X Discord" height="40">
  </a>

  <a href="https://github.com/gunta/emdash-x/releases" style="display:inline-block; margin-right:24px; text-decoration:none; outline:none; border:none;">
    <img src="./docs/media/downloadformacos.png" alt="Download app for macOS" height="40">
  </a>

  <a href="https://x.com/gunta" style="display:inline-block; text-decoration:none; outline:none; border:none;">
    <img src="https://img.shields.io/badge/Follow%20@gunta-%23000000.svg?logo=x&logoColor=white" alt="Follow on X" height="40">
  </a>
</div>

<br />
<br />

  <p align="center">
  <img src="./docs/media/modelselector.png" alt="Provider selector showing supported CLIs" width="360">
  <br />
  <em>Emdash X supports all major CLI providers with Jujutsu-powered parallelism</em>
  <br />
</p>

<p align="center">
    <img src="./docs/media/emdash-screenshot.png" alt="Emdash X app screenshot" width="100%">
</p>

## Install

### Prerequisites
- **[Jujutsu (jj)](https://github.com/martinvonz/jj)** - The modern VCS powering Emdash X
  ```bash
  # macOS
  brew install jj
  
  # Linux
  cargo install --locked jj-cli
  
  # Windows
  cargo install --locked jj-cli
  ```

### macOS

- Download for macOS (Apple Silicon): https://github.com/gunta/emdash-x/releases/latest/download/emdash-x-arm64.dmg
- Download for macOS (Intel x64): https://github.com/gunta/emdash-x/releases/latest/download/emdash-x-x64.dmg

### Linux

- Download AppImage (x64): https://github.com/gunta/emdash-x/releases/latest/download/emdash-x-x64.AppImage
- Download Debian package (x64): https://github.com/gunta/emdash-x/releases/latest/download/emdash-x-x64.deb

### Windows

- Download Portable Exe (x64): https://github.com/gunta/emdash-x/releases/latest/download/emdash-x-x64.exe
- Download NSIS Installer (x64): https://github.com/gunta/emdash-x/releases/latest/download/emdash-x-x64-installer.exe

### Manual Installation

Either download the package for your platform from Releases (links above), or build and run the app locally — see Requirements and Getting Started below.

### Homebrew

[![Homebrew](https://img.shields.io/badge/-Homebrew-000000?style=for-the-badge&logo=homebrew&logoColor=FBB040)](https://formulae.brew.sh/cask/emdash-x)

Install and manage Emdash X with Homebrew:

```bash
# Install
brew install --cask emdash-x

# Upgrade
brew upgrade --cask emdash-x

# Uninstall
brew uninstall --cask emdash-x
```

If Homebrew does not find the cask yet, run `brew update`.

## Requirements

- Node.js 22.12.0+ and Jujutsu (jj)
- One or more providers (install as needed):
  - [OpenAI Codex CLI](https://github.com/openai/codex) (install + authenticate)
  - Optional: [Claude Code CLI](https://www.npmjs.com/package/@anthropic-ai/claude-code) (install + authenticate)
- Optional: [GitHub CLI](https://docs.github.com/en/github-cli/github-cli/quickstart) for PRs, badges, and repo info

### Jujutsu Setup

Initialize Jujutsu for your repository:

```bash
# Clone with Jujutsu (colocated with Git)
jj git clone https://github.com/your/repo
cd repo

# Or initialize in existing Git repo
cd your-git-repo
jj init --git-repo .

# Configure your identity
jj config set --user user.name "Your Name"
jj config set --user user.email "you@example.com"
```

### Codex CLI

Install the Codex CLI and authenticate it:

```bash
npm install -g @openai/codex
# or
brew install codex

# authenticate
codex
```

### Claude Code CLI (optional)

Install the Claude Code CLI and authenticate it:

```bash
npm install -g @anthropic-ai/claude-code

# start and login
claude
# then use /login inside the CLI
```

### GitHub CLI

Install and authenticate GitHub CLI for GitHub features:

**Install [GitHub CLI](https://docs.github.com/en/github-cli/github-cli/quickstart):**

- **macOS:** `brew install gh`
- **Linux:** `sudo apt install gh` (Ubuntu/Debian) or `sudo dnf install gh` (Fedora)
- **Windows:** `winget install GitHub.cli`

**Authenticate:**

```bash
gh auth login
```

## Getting Started

### Prerequisites

1. **Node.js 20.0.0+ (recommended: 22.20.0)** and Jujutsu
2. Install and authenticate at least one provider (Codex or Claude Code)
3. (Optional) Install and authenticate [GitHub CLI](https://docs.github.com/en/github-cli/github-cli/quickstart)

### Development Setup

1. **Clone this repository**
   ```bash
   jj git clone https://github.com/gunta/emdash-x.git
   cd emdash-x
   # Or with traditional git:
   git clone https://github.com/gunta/emdash-x.git
   cd emdash-x
   ```

2. **Use the correct Node.js version**
   
   This project uses Node.js 22.20.0. Choose one:

   **Option A: Using nvm (recommended)**
   ```bash
   nvm use
   # or if you don't have v22.20.0 installed:
   nvm install
   ```

   **Option B: Manual installation**
   - Download and install Node.js 22.20.0 from [nodejs.org](https://nodejs.org/)

3. **Install and run**
   ```bash
   npm run d
   ```
   
   This single command installs dependencies, rebuilds native modules, and starts the dev server.
   
   Alternatively, you can run these steps separately:
   ```bash
   npm install  # Install dependencies
   npm run dev  # Start development server
   ```

### Troubleshooting

#### SIGSEGV / Segmentation Fault on Startup

If you encounter a segmentation fault (SIGSEGV) when running the app, it's caused by native modules (sqlite3, node-pty, keytar) compiled for the wrong Node.js/Electron version.

**Quick fix:**
```bash
npm run rebuild
```

**If that doesn't work, nuclear option:**
```bash
npm run reset
```

This removes `node_modules` and reinstalls everything from scratch.

### Usage

In the chat input, use the provider selector to switch between different agents. Emdash X automatically creates Jujutsu worktrees for each agent session, ensuring complete isolation and parallel execution.

## Build from Source

### macOS

```bash
npm run package:mac
```

Outputs: `release/emdash-x-arm64.dmg` and `release/emdash-x-arm64.zip`

### Linux

Install build dependencies:

```bash
# Debian/Ubuntu
sudo apt-get install -y python3 python3-dev build-essential

# Fedora/RHEL
sudo dnf install -y python3 python3-devel gcc gcc-c++ make

# Arch
sudo pacman -S python base-devel
```

Build the app:

```bash
npm run package:linux
```

Outputs: `release/emdash-x-x64.AppImage` and `release/emdash-x-x64.deb`

### Windows

Install build dependencies (via [Chocolatey](https://chocolatey.org/)):

```powershell
choco install python build-essentials
```

Or install manually:
- [Python 3](https://www.python.org/downloads/)
- [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/)

Build the app:

```bash
npm run package:win
```

Outputs: `release/emdash-x-x64.exe` (portable) and `release/emdash-x-x64-installer.exe` (NSIS installer)

## Demos

### Jujutsu-Powered Parallel Execution

<p align="center">
  <img src="./docs/media/parallel.gif" alt="Demo: Jujutsu parallel agents" width="100%" style="border-radius:12px">
  <br>
  <em>Multiple agents working in true parallel with Jujutsu's lock-free operations</em>
</p>

### Automatic Versioning & Time Travel

<p align="center">
  <img src="./docs/media/demo.gif" alt="Demo: automatic versioning" width="100%" style="border-radius:12px">
  <br>
  <em>Every agent action is automatically versioned - never lose work again</em>
</p>

### Conflict-Free Pull Requests

<p align="center">
  <img src="./docs/media/openpr.gif" alt="Open a PR from the Emdash X dashboard" width="100%" style="border-radius:12px">
  <br>
  <em>Merge agent work seamlessly with Jujutsu's superior conflict handling</em>
</p>

## Data Persistence

Emdash X uses SQLite for local data persistence with additional Jujutsu operation tracking:

### Enhanced Database Schema

In addition to the standard Emdash tables, Emdash X adds:

```sql
CREATE TABLE jj_operations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  description TEXT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE
);

CREATE TABLE agent_memory (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  context TEXT,
  embeddings BLOB,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (agent_id) REFERENCES workspaces (agent_id) ON DELETE CASCADE
);
```

### Data Location

The SQLite database is automatically created in your system's application data directory:

- **macOS**: `~/Library/Application Support/emdash-x/emdash-x.db`
- **Windows**: `%APPDATA%/emdash-x/emdash-x.db`
- **Linux**: `~/.config/emdash-x/emdash-x.db`

## What's Next

### Immediate Roadmap
- [x] Jujutsu worktree integration
- [ ] Beads task tracking UI
- [ ] cc-sdd structured decomposition
- [ ] Visual operation history browser
- [ ] Automatic conflict resolution AI

### Experimental Features
- [ ] Multi-model consensus voting
- [ ] Agent memory persistence & sharing
- [ ] Distributed agent orchestration
- [ ] Time-travel debugging interface
- [ ] Native Jujutsu GUI operations

## Contributing

We welcome contributions! Especially interested in:
- Jujutsu integration improvements
- Agent memory systems
- Task management plugins
- Conflict resolution strategies

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Security & Privacy

- Your code, chats, and repository contents stay local
- Emdash X does not send your code or chats to us
- Third-party CLIs (Codex, Claude, GitHub CLI) transmit data per their policies
- Jujutsu operations are fully local with optional Git remote sync

### Telemetry

By default, Emdash X collects anonymous usage statistics to improve the product:
- Lifecycle events (app start/close)
- Feature usage (feature name only, no content)
- Non-identifying context (version, platform)
- **Never collected**: code, prompts, repository names, file paths

**Opt-out:** Settings → General → Privacy & Telemetry, or set `TELEMETRY_ENABLED=false`

<p align="center">
  <img src="./docs/media/disabletelemetry.png" alt="Privacy & Telemetry settings toggle" width="720">
</p>

## Credits

- Original [Emdash](https://github.com/generalaction/emdash) by the Emdash team
- Forked and extended by [@gunta](https://github.com/gunta)
- Powered by [Jujutsu](https://github.com/martinvonz/jj) - the next-generation VCS
- Inspired by [Parallel Claude Code with Jujutsu](https://slavakurilyak.com/posts/parallel-claude-code-with-jujutsu/)
- Integrating [Beads](https://github.com/steveyegge/beads) and [cc-sdd](https://github.com/gotalab/cc-sdd)

## License

MIT - See [LICENSE.md](LICENSE.md)

---

**Emdash X** - Because parallel agents deserve a parallel-first VCS. 🚀