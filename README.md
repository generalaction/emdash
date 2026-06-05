<div align="center">

# Rundash

**Run AI coding agents in parallel — locally, over SSH, or triggered by webhooks on your own server.**

[![Apache 2.0 License](https://img.shields.io/badge/License-Apache_2.0-555555.svg?labelColor=333333&color=666666)](./LICENSE.md)

</div>

Rundash is a desktop app for running AI coding agents in parallel. Each task runs in its
own Git worktree, so you can explore multiple fixes or features at once, review the
diffs, and merge what works.

It works with local projects and remote machines over SSH. Bring the CLI agents you
already use: Claude Code, Codex, OpenCode, Gemini, Amp, and more.

Rundash also adds **webhook-triggered automations**: a lightweight server
(`emdash-server`) receives webhooks (GitHub, Linear, or any generic POST), and an
agent runs in response — either on your desktop, or fully headless on your own server
in an isolated Docker container.

> Rundash is a fork of [Emdash](https://github.com/generalaction/emdash) by General
> Action. The webhook trigger system, the `emdash-server` package, and the Dockerized
> server-side runner are additions in this fork.

## What You Can Do

- Run multiple coding agents at once without juggling terminals.
- Keep every agent isolated in its own Git worktree and branch.
- Send issues and tickets from Linear, GitHub, Jira, GitLab, Asana, Featurebase,
  Monday.com, Forgejo, or Plain into an agent.
- **Trigger automations from webhooks** — fire an agent when a GitHub/Linear event (or
  any HTTP POST) arrives.
- **Run agents headless on your own server**, each in a throwaway Docker container.
- Review diffs, create pull requests, inspect CI checks, and merge from one place.
- Work locally or on your own remote machines over SSH/SFTP.

## Build & Run (from source)

This fork is built from source rather than distributed as packaged downloads.

```bash
pnpm install        # postinstall rebuilds native modules (better-sqlite3, node-pty)
                    # against the bundled Electron version
pnpm dev            # run the desktop app in development
```

To produce platform builds:

```bash
pnpm package:mac    # macOS .dmg
pnpm package:linux  # Linux AppImage / .deb / .rpm (x64)
pnpm package:win    # Windows .msi / .exe
```

> Native modules (`better-sqlite3`, `node-pty`) are compiled for Electron's ABI on
> install. If you hit a `Napi::Error` at runtime after switching Node/Electron
> versions, run `pnpm rebuild` to recompile them.

## Agents

Rundash detects installed provider CLIs automatically. It supports agents like Claude
Code, Codex, Cursor, OpenCode, Gemini, Amp, Devin, Qwen Code, Droid, and GitHub
Copilot.

Provider behavior (flags, auto-approve, headless modes) is defined in
[`src/shared/agent-provider-registry.ts`](src/shared/agent-provider-registry.ts).

## Webhook Automations

Create an automation with a **webhook trigger** in the app. Each automation gets a
unique token; POST to the server's `/webhook/<token>` endpoint to fire it. Events from
GitHub and Linear are detected automatically; any other POST is treated as a generic
event.

The receiver is a small Fastify + SQLite service in
[`packages/emdash-server`](packages/emdash-server). Deploy it to a home server or VPS:

```bash
cd packages/emdash-server
EMDASH_SERVER_USER=<user> EMDASH_SERVER_HOST=<host> ./deploy.sh
# optionally: ./deploy.sh --tunnel   # set up a Cloudflare Tunnel for public access
```

By default the desktop app polls the server and runs the agent locally. See the server
package for the connection setup.

## Server-Side Agent Runner (Docker)

To run agents **on the server itself** — headless, isolated, no desktop app — use the
Dockerized runner built into `emdash-server`. Each webhook runs `claude` in a throwaway
container mounted against a checkout of your repo.

```bash
# on the server, after deploy.sh:
cd /opt/emdash-server
./setup-runner.sh \
  --token  <webhook-token> \
  --repo   <git-clone-url> \
  --path   /opt/projects/<repo> \
  --prompt "What the agent should do on each event."
```

Authentication uses a long-lived OAuth token from `claude setup-token` (subscription-
backed, no per-call API key). The container env carries only that token — never an
`ANTHROPIC_API_KEY`, which would override it.

Full runbook: [`packages/emdash-server/runner/README.md`](packages/emdash-server/runner/README.md).
Design notes: [`docs/superpowers/specs/2026-06-05-dockerized-agent-runner-design.md`](docs/superpowers/specs/2026-06-05-dockerized-agent-runner-design.md).

## Remote Projects

Connect to remote machines with SSH/SFTP and run the same parallel workflow on remote
codebases. Rundash supports SSH agent, key, and password authentication, with
credentials stored in your OS keychain.

## Privacy

Rundash is local-first. App state is stored in a local SQLite database, and the app
does not send your code or chats to any Rundash server.

Agent CLIs may send code, prompts, and context to their own providers. Their data
handling depends on the provider you choose.

Telemetry is optional and can be disabled in Settings or by launching with:

```bash
TELEMETRY_ENABLED=false
```

## Credits

Rundash builds on [Emdash](https://github.com/generalaction/emdash) by General Action,
licensed under Apache-2.0. Upstream docs for the core desktop features live at
[emdash.sh/docs](https://emdash.sh/docs).

## License

Licensed under the [Apache-2.0 license](LICENSE.md).
