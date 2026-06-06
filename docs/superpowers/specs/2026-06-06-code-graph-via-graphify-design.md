# Code-Graph for Agents via Graphify — Design

**Status:** Approved for build (v1: code-only, per-worktree)
**Date:** 2026-06-06

## Goal

Stop agents from starting cold. Today, when an agent (Claude Code et al.) is
asked "how does feature X work," it re-derives the codebase structure from
scratch every task, in every worktree — Rundash injects nothing but the initial
prompt and gives the agent no map. The goal is to give each agent a
**queryable code graph over its worktree, reachable as an MCP tool**, so it can
ask "where is `upsertTask` defined / what imports `search-service.ts` / who
calls this" instead of grepping cold.

Success = **an agent in a Rundash worktree can answer a structural question by
querying the graph via MCP, without reading the whole tree.**

## Key decision: adopt Graphify, don't build the engine

[Graphify](https://github.com/safishamsi/graphify) (MIT, Python) already
implements almost exactly the subsystem we scoped:

- **Extraction** — tree-sitter AST analysis, 28+ languages, **code-only mode is
  fully local with zero API calls**. `graphify extract . --update` re-extracts
  only changed files.
- **Storage** — a portable, per-folder `graph.json` (relative paths) plus
  `GRAPH_REPORT.md` and an interactive `graph.html`, written to `graphify-out/`,
  co-located with the repo.
- **MCP server** — `python -m graphify.serve graph.json` exposes `query_graph`,
  `get_node`, `shortest_path` over stdio. This is precisely the MCP surface
  Rundash does **not** have today.
- **Self-update** — `graphify hook install` adds a post-commit hook (AST-only
  rebuild, no API cost) and a merge driver that union-merges `graph.json`.

Building a Node-native equivalent would re-implement mature, tested work
(tree-sitter grammars for 28 languages, incremental update, an MCP server) that
we would then own and maintain. Graphify is MIT-licensed, so adoption is clean.

**The only cost** is a Python toolchain (`uv`/`pipx` + `graphifyy`) on the host
where the worktree lives. We handle that by detecting and degrading gracefully
(below), and by baking it into the Docker runner image.

### What we build vs. what we adopt

| Unit | Source |
|---|---|
| Code extractor (tree-sitter, 28 langs) | **Graphify** |
| `graph.json` store, co-located per-repo | **Graphify** |
| stdio MCP server (`query_graph`, `get_node`, `shortest_path`) | **Graphify** |
| Freshness (incremental update, commit hook, merge driver) | **Graphify** |
| **`CodeGraphService` orchestrator** | **Rundash (this build)** |

We own no parser, no graph schema, and no MCP server of our own.

## Topology

Rundash has two runtime topologies, and the design must work for both:

- **Local / SSH** — the desktop app runs agents on the user's machine (or an
  SSH target); worktree, agent process, and graph all sit on that host.
- **Dockerized runner** (`packages/emdash-server`) — agents run in throwaway
  containers on a remote server; the worktree is bind-mounted at `/work`, while
  the desktop app's DB is back on the laptop with no RPC channel.

Because the graph (`graph.json`) is **derived data co-located with the
worktree**, and the MCP server runs **beside the agent on the same host**, both
topologies work with one design: extraction and querying always happen on the
worktree's host. The Electron main process only orchestrates.

```
┌──────────── Host where the worktree lives (laptop OR Docker runner) ────────────┐
│                                                                                  │
│   worktree files ──▶ graphify extract --update ──▶ graphify-out/graph.json       │
│                                                            ▲                      │
│   agent (Claude Code) ◀── stdio ──▶ graphify.serve graph.json (MCP)              │
│       tools: query_graph · get_node · shortest_path                              │
└──────────────────────────────────────────────────────────────────────────────┘
        ▲ orchestrates: provision · trigger extract · wire MCP config · status
┌───────┴──────────────────────────────┐
│ Electron main — CodeGraphService      │  (singleton + RPC, house pattern)
└───────────────────────────────────────┘
```

## CodeGraphService — responsibilities

A singleton main-process service with an RPC controller, following the existing
`*-service.ts` + `controller.ts` + `rpc.ts` registration pattern (e.g. tasks,
search). It does **not** parse code or run queries. Its four jobs:

### 1. Provision (detect + guide, degrade gracefully)

Check whether `python` + `graphify` are available on the worktree's host
(locally via subprocess probe; over SSH via remote probe; in the runner image,
baked in at build time). If absent, the graph feature is simply **unavailable**
— surfaced as a status with an install hint (`uv tool install graphifyy`). It
**never blocks** normal Rundash use. No auto-install lifecycle in v1.

### 2. Trigger extraction (per-worktree)

On worktree creation and on git `status:updated` events, run
`graphify extract --update` in that worktree, **debounced** (reuse the
file-index 3s debounce pattern) and **serialized per repo** (reuse the
`enqueueGitOp` queue pattern), fire-and-forget so the main thread never blocks.
Also run `graphify hook install` once per worktree so commits self-update
without Rundash in the loop.

**Freshness is fully delegated to Graphify.** We deliberately do **not** build a
shared-baseline / per-worktree-overlay scheme: each worktree runs its own
incremental `extract --update`. Graphify's incremental update keeps re-cost low;
the only downside is N near-identical worktrees each hold a full `graph.json`.
If first-extract latency or disk ever hurts in practice, baseline-sharing via
`graphify merge-graphs` is a future optimization — not v1.

### 3. Wire the MCP server into the agent config

Write the `python -m graphify.serve <worktree>/graphify-out/graph.json` stdio
MCP server entry into each worktree's agent MCP config, reusing the existing
config-writing in `McpService` (which already manages MCP server configs across
providers). The agent then spawns the graph MCP server itself on session start.

### 4. Surface status in the UI (pill + detail popover)

Expose per-worktree graph status to the renderer over RPC and show it in the
worktree/task header:

- **Status pill** reflecting `building | ready | unavailable` (with a
  `last-indexed` timestamp underneath `ready`). The pill is always visible while
  a worktree is open.
- **Click-through detail popover** with: symbol/file counts, last-index time,
  the engine line (`graphify <version>, code-only`), confirmation that the MCP
  server is registered for the active agent, and a manual **Re-index** button
  (invokes job #2's `extract --update` on demand).

The `unavailable` state surfaces the install hint from job #1 (e.g. "install
graphify to enable") rather than an error. No new top-level view is required —
the pill lives in the existing worktree header and the popover is a standard
detail panel. The status RPC is shaped so a future global activity surface
(all worktrees/hosts at once) could consume it without rework, but that
cross-worktree view is explicitly out of scope for v1.

## v1 scope: code-only

v1 runs **only code extraction** (tree-sitter, fully local, no API key, no
per-extract token cost). This covers the goal — agents understand code structure
without grepping cold. Graphify's LLM-driven semantic extraction over
Markdown/PDFs/diagrams (richer "why" context, but needs an API key and adds
per-extract token cost) is **deferred** to a later iteration.

## What we are NOT building (YAGNI)

- No Node-native tree-sitter indexer.
- No graph schema / SQLite tables of our own — Graphify owns `graph.json`.
- No baseline/overlay scope-tagging scheme — per-worktree extract instead.
- No Rundash-hosted network MCP service — stdio, co-located, per worktree.
- No auto-install of Python — detect and degrade.
- No docs/PDF/diagram semantic extraction in v1.
- No new top-level renderer view/modal — status is a pill + detail popover in
  the existing worktree header.
- No global cross-worktree activity surface in v1 (the status RPC is shaped to
  allow it later, but it is not built now).

## Integration points (existing code to reuse)

- **Service + RPC pattern:** `src/main/core/tasks/` (service + `controller.ts`)
  and registration in `src/main/rpc.ts`.
- **Debounce + serialized work:** `src/main/core/search/workspace-file-index-service.ts`
  (3s debounce) and `worktree-service.ts` `enqueueGitOp` (serialized git ops).
- **Worktree lifecycle hook:** `src/main/core/workspaces/workspace-factory.ts`
  `onCreateSideEffect` / `onDestroy` (where the file index is already wired in).
- **Git change events:** the `status:updated` hook on the workspace git provider.
- **MCP config writing:** `src/main/core/mcp/services/McpService.ts`.
- **Docker runner image:** `packages/emdash-server/runner/Dockerfile` (bake in
  Python + graphify there).

## Open risks

- **`refs` precision.** Graphify's references are tree-sitter-derived
  (name-matched, not type-resolved); "who calls X" can over-match. Acceptable
  for v1 — agents treat it as a strong lead, not ground truth. Worth confirming
  Graphify's own MCP output labels confidence; if not, note it in the agent
  guidance we ship.
- **Python provisioning over SSH.** Remote hosts may lack Python; the
  degrade-gracefully path must be genuinely silent (status only, no errors in
  the normal flow).
- **MCP config collisions.** Writing into agent configs must not clobber the
  user's existing MCP servers; reuse `McpService`'s merge semantics, scoped per
  worktree.

## Milestones

1. **Spike (prove the win):** wire Graphify into one local worktree by hand,
   point Claude Code at its MCP server, measure token/quality delta on this
   codebase. (Validates the premise before integration.)
2. **CodeGraphService v1:** provision-probe + per-worktree `extract --update` on
   create/change + commit-hook install.
3. **MCP wiring:** register the graph MCP server in agent config via `McpService`.
4. **Status UI:** status RPC + header pill (`building/ready/unavailable`) +
   detail popover (counts, last-indexed, MCP-wired confirmation, Re-index button).
5. **Runner image:** bake Python + graphify into the Docker runner Dockerfile.
