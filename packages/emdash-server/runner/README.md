# emdash-server agent runner — runbook

Runs webhook-triggered agents on the server, each in an isolated Docker
container. No Electron, no Xvfb. Design:
`docs/superpowers/specs/2026-06-05-dockerized-agent-runner-design.md`.

## Quick path: `setup-runner.sh` (recommended)

After `emdash-server` is deployed (via `deploy.sh`), SSH to the server and run
the one-shot setup script. It is idempotent — re-run it to change the prompt,
rotate the token, or add another automation.

```bash
# on the server, from where deploy.sh synced the package (e.g. /opt/emdash-server)
cd /opt/emdash-server
./setup-runner.sh \
  --token  wh_810f6d8cfca484d05543d034c678c22a520724b2d0813e41 \
  --repo   https://github.com/you/doc-engine.git \
  --path   /opt/projects/doc-engine \
  --prompt "Review the repo for exploitable security vulnerabilities."
```

It will: install Docker + jq if missing, build the `emdash-runner` image, clone
the repo, **prompt you (hidden) for the Claude OAuth token** from
`claude setup-token`, upsert the automation into `~/.emdash-server/config.json`,
enable the runner, and restart pm2. Then it prints the test-webhook command.

Pass `--oauth-token TOKEN` to supply the token non-interactively (it won't be
echoed, but it will be in your shell history — prefer the prompt). Add `--push`
to enable `git push` after runs. `--help` lists all flags.

> First run only: if Docker had to add you to the `docker` group, **re-login**
> afterwards so the node process can run `docker` without sudo.

The rest of this doc is the manual equivalent, for reference or debugging.

## One-time setup (on the server) — manual

### 1. Prerequisites

```bash
docker --version            # Docker must be installed and the daemon running
sudo usermod -aG docker "$USER"   # run docker without sudo (re-login after)
```

### 2. Get a Claude OAuth token

On any machine where you're logged into Claude Code with your Pro/Max plan:

```bash
claude setup-token          # walks through OAuth, prints a 1-year token
```

Copy the printed token. It is NOT saved anywhere by that command.

> Note: from 2026-06-15, `claude -p` on subscription plans draws from a separate
> monthly Agent SDK credit pool, distinct from interactive limits.

### 3. Build the runner image

```bash
# from the deployed emdash-server dir (where deploy.sh syncs to, e.g. /opt/emdash-server)
docker build -t emdash-runner:latest runner/
# add language toolchains your repos need by editing runner/Dockerfile
```

### 4. Clone the target repo

```bash
sudo mkdir -p /opt/projects && sudo chown "$USER:$USER" /opt/projects
git clone <repo-url> /opt/projects/doc-engine
```

### 5. Configure the runner

Edit `~/.emdash-server/config.json` and add the OAuth token, enable the runner,
and define one automation. The `token` must match the webhook token your
automation uses (the same one your webhook URL ends with).

```jsonc
{
  "apiKey": "…(existing)…",
  "port": 8080,
  "host": "0.0.0.0",
  "dbPath": "…(existing)…",
  "signingSecrets": {},
  "routes": [],

  "claudeOauthToken": "<paste from claude setup-token>",
  "runner": { "enabled": true, "pollIntervalMs": 5000, "maxConcurrent": 1 },
  "automations": [
    {
      "token": "wh_810f6d8cfca484d05543d034c678c22a520724b2d0813e41",
      "repoPath": "/opt/projects/doc-engine",
      "prompt": "Review the repository for validated high-impact security vulnerabilities. Only report or fix exploitable issues.",
      "image": "emdash-runner:latest",
      "push": false
    }
  ]
}
```

`push: false` for the first run — prove the commit lands, then flip to `true`
once git push auth is set up on the checkout.

### 6. Restart the server

```bash
pm2 restart emdash-server
pm2 logs emdash-server      # expect: "runner started: 1 automation(s), poll 5000ms…"
```

## Fire a test run

```bash
curl -X POST http://localhost:8080/webhook/wh_810f6d8cfca484d05543d034c678c22a520724b2d0813e41 \
  -H 'Content-Type: application/json' -d '{}'

# within ~5s the worker picks it up and runs the container. Watch:
pm2 logs emdash-server
# success criterion — a new commit in the repo:
git -C /opt/projects/doc-engine log --oneline -3
```

## How it works

1. `POST /webhook/:token` stores a `pending` row (unchanged).
2. The worker polls the queue every `pollIntervalMs`, maps token → automation.
3. Runs: `docker run --rm -u <uid:gid> -v <repo>:/work -w /work
   -e CLAUDE_CODE_OAUTH_TOKEN=… -e PROMPT=… -e HOME=/tmp emdash-runner
   bash -lc "git pull && claude -p \"$PROMPT\" --dangerously-skip-permissions"`.
4. Exit 0 → event `processed`; non-zero/timeout → `failed` (error stored).

## Security properties

- Each run is a throwaway `--rm` container; the agent sees only the mounted repo.
- The container env carries ONLY the OAuth token + prompt + `HOME=/tmp`. No
  `ANTHROPIC_API_KEY` (which would outrank the OAuth token), no host env.
- Container runs as the host uid:gid, so commits are owned by you, not root.

## Troubleshooting

- **"runner disabled"** in logs → set `runner.enabled: true`.
- **Event stuck `pending`** → no automation matches that token; check `token`.
- **Event `failed`, error mentions auth** → OAuth token missing/expired; re-run
  `claude setup-token` and update config.
- **`failed to spawn docker`** → Docker not installed / daemon down / user not
  in the `docker` group.
- **Permission denied writing repo** → ensure the checkout is owned by the same
  uid the server runs as.
- Inspect any event: `GET /api/events` (Bearer apiKey) or query the DB.
