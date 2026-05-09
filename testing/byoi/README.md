# Emdash BYOI Testing Kit

A copy-pasteable setup for testing emdash's BYOI (Bring Your Own Infrastructure) feature.
Each task gets its own Docker container running a full Linux dev environment with Node.js, git, tmux, and Claude Code pre-installed.

## How it works

1. When you create a task, emdash runs `provision.sh`
2. The script builds a Docker image (first run only), starts a new container, clones your repo into it, and prints a JSON blob
3. Emdash SSH-connects to the container using password auth and opens the workspace at `/home/devuser/workspace`
4. When you terminate the task, emdash runs `terminate.sh` which stops and removes the container

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) running on your machine
- `jq` for JSON output — install with `brew install jq` on macOS

## Setup

Copy these files into the root of the repo you want to test with:

```
Dockerfile
entrypoint.sh
scripts/
  provision.sh
  terminate.sh
emdash.json.example  →  rename to .emdash.json
```

Make the scripts executable:

```bash
chmod +x scripts/provision.sh scripts/terminate.sh
```

Add the project in emdash, then create a task. That's it.

## First provision

The first provision builds the Docker image (~2-3 minutes, one-time). Subsequent provisions start a new container and clone the repo (~10-20 seconds).

## Forwarding API keys

The provision script forwards API keys from your host environment into the container automatically. Just make sure the relevant variables are set in your shell before emdash runs the provision script:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export GH_TOKEN=ghp_...
```

To add more keys, edit the `docker run` call in `scripts/provision.sh` and the `AGENT_VARS` list in `entrypoint.sh`.

## Container credentials

- **Username:** `devuser`
- **Password:** `devpass`
- **Workspace path:** `/home/devuser/workspace`

Change the password in `Dockerfile` (`devuser:devpass`) and `scripts/provision.sh` (`CONTAINER_PASS`) if needed.

## Cleanup

Containers are removed automatically when a task is terminated. To manually clean up any leftover containers:

```bash
docker ps --filter label=emdash.purpose=byoi-workspace
docker rm -f $(docker ps -aq --filter label=emdash.purpose=byoi-workspace)
```

To remove the cached Docker image and force a rebuild on the next provision:

```bash
docker rmi emdash-byoi-workspace
```
