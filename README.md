<!-- Top banner: icon + macOS download button -->
<p align="left">
  <img src="./src/assets/images/emdash/emdash_logo.svg#gh-light-mode-only" alt="Emdash" height="40" style="vertical-align:middle;margin-right:12px;">
  <img src="./src/assets/images/emdash/emdash_logo_white.svg#gh-dark-mode-only" alt="Emdash" height="40" style="vertical-align:middle;margin-right:12px;">
  <a href="https://github.com/generalaction/stagehand/releases/latest">
    <img src="./docs/media/download-macos.png" alt="Download app for macOS" height="40" style="vertical-align:middle;">
  </a>
  
</p>

<p align="center">
    <img src="./src/assets/images/emdash/emdash_logo.svg#gh-light-mode-only"
  alt="Emdash" width="900">
    <img src="./src/assets/images/emdash/emdash_logo_white.svg#gh-dark-mode-only"
  alt="Emdash" width="900">
  </p>

emdash is a UI layer for running multiple Codex CLI agents in parallel, each isolated in its own Git worktree — so you can fan out tasks, keep changes compartmentalized, and manage everything from a single UI.

<p align="center">
    <img src="./docs/media/emdash-screenshot.png" alt="Emdash app screenshot" width="100%">
</p>

## Install

- Download for macOS (Apple Silicon): https://github.com/generalaction/stagehand/releases/latest/download/emdash-arm64.dmg
- Download for macOS (Intel x64): https://github.com/generalaction/stagehand/releases/latest/download/emdash-x64.dmg

Note: Builds are unsigned by default. On first launch, right‑click the app, choose Open, then confirm to bypass Gatekeeper. For signed/notarized builds, add Apple Developer credentials to GitHub Actions (see CI section below).

## Requirements

- Node.js 18+ and Git
- [OpenAI Codex CLI](https://github.com/openai/codex) (install + authenticate)
- Optional: [GitHub CLI](https://docs.github.com/en/github-cli/github-cli/quickstart) for PRs, badges, and repo info

### Codex CLI

Install the Codex CLI and authenticate it:

```bash
npm install -g @openai/codex
# or
brew install codex

# authenticate
codex
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

1. Ensure Node.js 18+ and Git are installed
2. Install and authenticate Codex CLI (see Requirements above)
3. Install and authenticate [GitHub CLI](https://docs.github.com/en/github-cli/github-cli/quickstart)
4. Clone this repository
5. Install dependencies: `npm install`
6. Run the app: `npm run dev`

## Demos

emdash in action

- Creating a CONTRIBUTIONS.md file for an open source repository

<p align="center">
  <img src="./docs/media/demo.gif" alt="Demo: parallel agents with preserved stream state" width="100%" style="border-radius:12px">

Running multiple Codex agents in parallel

- Monitor and review the work of several agents within emdash

<p align="center">
  <img src="./docs/media/parallel.gif" alt="Demo: parallel agents with preserved stream state" width="100%" style="border-radius:12px">
  
</p>

Open a Pull Request from the dashboard

- Review diffs, set title/description, choose target branch, and publish to GitHub — all from emdash

<p align="center">
  <img src="./docs/media/openpr.gif" alt="Open a PR from the emdash dashboard" width="100%" style="border-radius:12px">
</p>

## Data Persistence

emdash uses SQLite for local data persistence, ensuring your projects and workspaces are maintained across application sessions. All data is stored locally on your machine, providing privacy and offline functionality.

### Database Architecture

The application maintains two primary data structures:

#### Projects Table

Stores information about opened Git repositories and their GitHub integration status:

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  git_remote TEXT,
  git_branch TEXT,
  github_repository TEXT,
  github_connected BOOLEAN DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**Key Features:**

- **Unique Path Constraint**: Prevents duplicate project entries
- **Git Integration**: Tracks remote URLs and current branches
- **GitHub Status**: Monitors connection state with [GitHub CLI](https://docs.github.com/en/github-cli/github-cli/quickstart)
- **Automatic Timestamps**: Tracks creation and modification times

#### Workspaces Table

Manages isolated agent workspaces with their associated Git worktrees:

```sql
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  branch TEXT NOT NULL,
  path TEXT NOT NULL,
  status TEXT DEFAULT 'idle',
  agent_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);
```

**Key Features:**

- **Cascade Deletion**: Removing a project automatically cleans up associated workspaces
- **Status Tracking**: Monitors workspace state (idle, running, completed)
- **Agent Assignment**: Links workspaces to specific agent instances
- **Branch Management**: Tracks Git branch names for each workspace

### Data Location

The SQLite database is automatically created in your system's application data directory:

- **macOS**: `~/Library/Application Support/emdash/emdash.db`
- **Windows**: `%APPDATA%/emdash/emdash.db`
- **Linux**: `~/.config/emdash/emdash.db`

### Database Operations

The application provides a comprehensive set of database operations through the `DatabaseService`:

- **Project Management**: Save, retrieve, and delete project entries
- **Workspace Management**: Create, update, and remove workspace records
- **Automatic Initialization**: Database and tables are created on first launch
- **Error Handling**: Robust error handling with detailed logging

### Storage Usage

The application stores conversation history locally, which may consume disk space over time:

### Clearing Local Storage (Reset Database)

If you want to reset or reclaim space, you can delete the app's local database. This removes saved conversations and resets projects/workspaces. The database is recreated automatically on next launch.

Important

- Quit the app before deleting the DB to avoid file‑in‑use errors.
- Paths with spaces need quotes (e.g. `"Application Support"`).

Default locations (packaged app)

- macOS: `~/Library/Application Support/emdash/emdash.db`
- Windows: `%APPDATA%/emdash/emdash.db`
- Linux: `~/.config/emdash/emdash.db`

Development builds (Electron default)

- macOS: `~/Library/Application Support/Electron/emdash.db`

Note: legacy filenames we migrate from (safe to remove if present): `database.sqlite`, `orcbench.db`.

Quick commands (macOS)

```bash
# Quit the app first

# Packaged path (if you ran a built app)
rm -f "$HOME/Library/Application Support/emdash/emdash.db" \
      "$HOME/Library/Application Support/emdash/emdash.db-wal" \
      "$HOME/Library/Application Support/emdash/emdash.db-shm"

# Dev path (vite/electron dev)
rm -f "$HOME/Library/Application Support/Electron/emdash.db" \
      "$HOME/Library/Application Support/Electron/emdash.db-wal" \
      "$HOME/Library/Application Support/Electron/emdash.db-shm"

# Optional: remove legacy DB filenames if they exist
rm -f "$HOME/Library/Application Support/emdash/database.sqlite" \
      "$HOME/Library/Application Support/emdash/orcbench.db"
rm -f "$HOME/Library/Application Support/Electron/database.sqlite" \
      "$HOME/Library/Application Support/Electron/orcbench.db"

# One-liner to locate any emdash.db under your home folder (preview only)
find "$HOME" -type f -name 'emdash.db*' -print
```

## What's Next
- [ ] Pluggable provider system to run other CLI coding agents (e.g., Claude Code, Gemini CLI, aider, Warp) alongside Codex
- [ ] Workspace lifecycle hooks to run custom scripts on create, run, and archive (e.g., install deps, copy env files, clean up resources)
- [ ] Planning chat with controlled execution (draft actions in a separate chat, then run them one by one)
- [ ] Linear integration to track and close out issues

## Privacy

- Privacy
  - All data is local. The app does not send your code or chats to us.
  - Using Codex CLI or GitHub CLI transmits data to those providers per their policies.
