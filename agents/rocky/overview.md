# Rocky — Product Overview

Rocky is emdash reshaped for non-technical business users. The underlying Electron
infrastructure (PTY, git, MCP, automations, DB, notifications, parallel agents) is
preserved. What changes is the surface: the AI engine, the UX language, and the
removal of every developer-specific concept from view.

## North Stars

| Borrow from | What specifically |
|---|---|
| **Cursor agent window** | Chat-first, visible plan/to-dos, inline action-approval cards, mode switcher (Ask / Agent / Plan), model picker, @-mention context, stop/steer, background agents, checkpoints/undo, Cursor-style auto-run rules |
| **Claude.ai artifact panel** | Right-side panel rendering the produced document/table/diagram/web preview; preview ↔ source toggle; version history; highlight-to-edit; accept / reject |

## Target Users

Initial audience: portfolio managers, bankers, wealth managers, and the knowledge
workers who support them. Design is role-agnostic for any non-developer.

Representative jobs:
- Company research → one-pager or CRM update
- Inbox triage → action list
- Meeting prep → briefing doc
- Pipeline hygiene → CRM batch updates (all approved inline)

## Five Product Pillars

| Pillar | Status in emdash |
|---|---|
| Co-worker Chat (Cursor-style) | Partial — terminal-based today; needs structured-card rendering |
| Artifact Panel (Claude-style) | Not present — diff/review tab must be replaced |
| Automations | Full engine exists; needs UI elevation and public/private sharing |
| Marketplace (Skills + Connectors + Smithery) | Pieces exist (Library, MCP UI, skills.sh catalog); needs unification + Smithery |
| Settings (incl. Permissions & auto-run) | Exists; needs developer options stripped and Cursor-style auto-run added |

## Product Vocabulary (rename map)

Agents must use Rocky's user-facing terms in all UI code (labels, toasts, empty states,
onboarding). Internal code identifiers (DB column names, RPC methods, TypeScript types)
may keep the emdash names during the transition — change them when you touch a file, not
as a sweep.

| Rocky (user-facing) | emdash (internal) | Notes |
|---|---|---|
| Workspace | Project | Folders + connected apps, not a repo |
| Chat | Conversation / Task | One conversation is the unit of work |
| Co-worker | Agent | Never say "agent" to users |
| Artifact | (new) | Rendered output in the right panel |
| Connector | MCP server | Integration giving the co-worker a tool |
| Skill | Skill / slash command | Packaged know-how |
| Automation | Automation | Unchanged concept, elevated placement |
| Background agent | Parallel conversation | A chat running on its own |
| Checkpoint / Undo | Git worktree state | Friendly undo, never git terminology |
| Permissions & auto-run | (new) | Cursor-style approval/allowlist rules |

## What Is Never Shown to Users

These concepts must not appear in any user-facing string, label, or screen:

- Repository, repo, branch, commit, PR, pull request, merge, diff, worktree
- Terminal, shell, PTY, stdin, stdout
- CLI path, session flag, auto-approve flag, keystroke injection
- SSH host, BYOI, remote project
- Agent provider (Claude Code, Codex, etc.)

The machinery behind these still runs; it is just invisible.

## Key Decisions (locked)

- "Task" concept removed — a **Chat** is the unit of work and lives directly in a Workspace
- Action history is inline only (Cursor-style cards in the chat stream) — no separate log UI
- No admin role in v1 — sharing is peer-to-peer (public/private flags)
- Artifacts include all types: documents, tables, slides, diagrams, live web/HTML previews
- Data is local-first; only published/shared items go to the self-deployed backend
- Distribution is self-deployed, not SaaS

## Read Next

- `agents/rocky/transformation-map.md` — precise file-level keep/change/remove/add
- `agents/rocky/rocky-proxy.md` — engine integration spec
- `agents/rocky/artifact-panel.md` — the net-new right-side panel
- `agents/rocky/marketplace.md` — Skills + Connectors + Smithery
- `agents/rocky/phases.md` — build order
