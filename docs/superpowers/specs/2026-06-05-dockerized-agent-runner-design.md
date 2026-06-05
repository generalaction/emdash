# Dockerized Agent Runner in emdash-server — Design

**Status:** Approved for build (iteration 1: prove-it-works)
**Date:** 2026-06-05
**Supersedes:** `2026-06-05-headless-server-agent-runner-design.md` (headless Electron)

## Goal

Run webhook-triggered agents **on the home server**, each in an isolated Docker
container, without the Emdash desktop app. Success = **one webhook → `claude`
runs in a container against a repo and produces a commit**.

## Why this replaces the headless-Electron design

The desktop app is database-backed and UI-driven; running it headless required
Xvfb, a `.deb` build, node-pty (the source of the `Napi::Error` crash), and
SQLite config surgery. None of that is essential to "run an agent on a
webhook." `claude -p` is non-interactive — a plain subprocess — so the runner
can be a small worker that spawns a container. Isolation (a hard requirement
for external-webhook-triggered agents with `--dangerously-skip-permissions`) is
the reason for Docker.

## Architecture

```
External webhook → POST /webhook/:token → webhook_events (pending)   [EXISTS]
                                                │
                          Runner worker (NEW, in emdash-server):
                            poll pending events on an interval
                            token → config.automations[token]
                                     { repoPath, prompt, image, push }
                                                │
                            docker run --rm \
                              -u <hostUid>:<hostGid> \
                              -v <repoPath>:/work -w /work \
                              -e CLAUDE_CODE_OAUTH_TOKEN=<token> \
                              <image> \
                              bash -lc "git pull --ff-only && \
                                        claude -p '<prompt>' \
                                          --dangerously-skip-permissions ; \
                                        <push?> git push"
                                                │
                            capture exit + stdout/stderr →
                            mark event processed/failed (internal DB write)
```

No Electron, Xvfb, .deb, node-pty, or second SQLite for automations. The
existing `webhook_events` table is the only state. Automations live in the
existing `~/.emdash-server/config.json`.

## Authentication

`claude setup-token` mints a one-year OAuth token tied to the user's Pro/Max
subscription. It is stored in the server config and injected into each
container as `CLAUDE_CODE_OAUTH_TOKEN`. Works with `claude -p`.

**Precedence hazard (from Claude docs):** `ANTHROPIC_API_KEY` outranks
`CLAUDE_CODE_OAUTH_TOKEN`. The container env must therefore carry ONLY the OAuth
token and must NOT inherit a stray API key, or the key silently wins.

**Cost note (from Claude docs):** Starting 2026-06-15, `claude -p` on
subscription plans draws from a separate monthly "Agent SDK credit" pool,
distinct from interactive limits. Server automation volume is capped by that.

## Components

### 1. Config schema extension (`config.ts`)

Add an optional `automations` array to the existing zod config schema. Also add
an optional top-level `claudeOauthToken` and `runner` block:

```ts
automationSchema = z.object({
  token: z.string(),              // matches webhook_events.token
  repoPath: z.string(),           // host path, mounted into the container
  prompt: z.string(),
  image: z.string().default('emdash-runner:latest'),
  push: z.boolean().default(false),
  branch: z.string().optional(),  // if set, create/checkout before running
  timeoutMs: z.number().default(30 * 60 * 1000),
});

config += {
  claudeOauthToken: z.string().optional(),
  runner: z.object({
    enabled: z.boolean().default(false),
    pollIntervalMs: z.number().default(5000),
    maxConcurrent: z.number().default(1),
  }).default({}),
  automations: z.array(automationSchema).default([]),
}
```

### 2. Runner worker (`runner/worker.ts`, `runner/docker.ts`)

- `RunnerWorker` — start/stop, `setInterval` poll loop, concurrency gate
  (`maxConcurrent`). On each tick: fetch pending events from the DB, map each to
  its automation by token, run sequentially up to the concurrency limit.
- `runAgentInDocker(automation, oauthToken)` — builds the `docker run` argv and
  spawns via `child_process.spawn` (NOT node-pty). Returns
  `{ exitCode, stdout, stderr }`. Enforces `timeoutMs` (kill the container).
- Event lifecycle reuses the existing ack semantics: success → `processed`,
  non-zero/timeout → `failed` with the captured error. Done via the DB client
  directly (no HTTP round-trip).
- Events whose token has no configured automation are left `pending` (not
  failed) so they don't get lost if config is added later. (Mirrors the desktop
  watcher's "ack-and-skip" but we choose leave-pending to avoid silently
  dropping; revisit if it causes queue buildup.)

### 3. Runner image (`runner/Dockerfile`)

Minimal Debian-slim image: install git + `claude` (native installer) + the
repo's toolchain (node for doc-engine). Entry is plain `bash`. Built once on
the server: `docker build -t emdash-runner:latest`.

### 4. Wiring into `cli.ts`

`emdash-server start` constructs the `RunnerWorker` after the Fastify server
listens, and starts it only if `config.runner.enabled`. Graceful stop on
SIGINT/SIGTERM.

### 5. Identity / permissions

Container runs as the host uid:gid (`-u $(id -u):$(id -g)`) so commits in the
mounted repo are owned by the host user and git push uses host-mounted creds (a
read-only mount of the host's git credential helper or an SSH deploy key
mounted into the container). For iteration 1, `push: false` is the default —
prove the commit first, wire push second.

## Data flow (one run)

1. `POST /webhook/<token>` → `pending` row (existing).
2. Worker tick (≤ `pollIntervalMs`) sees it, looks up `automations[token]`.
3. `docker run` the image: `git pull`, `claude -p "<prompt>"
   --dangerously-skip-permissions`, optional `git push`.
4. Capture exit/output; write `processed` (0) or `failed` (non-zero/timeout).
5. `git log` in the host repo shows the new commit (the success criterion).

## Error handling

| Failure | Handling |
|---|---|
| Token has no automation | Leave event `pending` (don't drop); log a warning |
| `docker` not installed / daemon down | Run fails; event `failed` with clear error; worker keeps polling |
| OAuth token missing/expired | Container exits non-zero; event `failed`; surfaced in stderr |
| Stray `ANTHROPIC_API_KEY` in container | Prevented: env allowlist — only `CLAUDE_CODE_OAUTH_TOKEN` passed |
| Agent run hangs | `timeoutMs` kills the container; event `failed` (timeout) |
| Commit perms wrong | Container runs as host uid:gid |
| git push rejected | Captured in stderr; `push:false` default sidesteps for iter 1 |

## Testing

- **Unit (vitest, runs here):** `runner/docker.ts` argv builder — given an
  automation + token, produces the exact `docker run` arg array (env allowlist,
  `-u`, `-v`, `-w`, image, command). Pure function, no Docker needed.
- **Unit:** `RunnerWorker` tick logic with a mocked DB + mocked runner — pending
  event with a matching automation → runner invoked + event acked processed;
  no matching automation → left pending; runner throws → event failed.
- **Manual (on server):** `docker build`, set `claudeOauthToken` + one
  automation in config, `emdash-server start`, fire the webhook, see a commit.

## Out of scope (later)

- systemd auto-start (still pm2/manual for now)
- git push hardening (deploy keys), network egress lockdown
- streaming run output to the Mac UI; run history beyond `webhook_events`
- multiple images / per-repo toolchains beyond the first
- the headless-Electron path (superseded, kept as fallback doc)

## Execution constraint

The runner CODE is written and unit-tested in this repo. Building the image,
setting the OAuth token, and the end-to-end run happen on the server (not
reachable from the dev environment). Deliverable includes the code + a short
runbook.
