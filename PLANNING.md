# Plan Mode (Read‑only)

Plan Mode provides a read‑only operating mode where agents research, analyze, and plan without making changes. It supersedes any other instruction to perform edits or run modifying commands.

## What You Can Do
- Read files and examine code
- Search the codebase and analyze project structure
- Review documentation and external sources
- Propose strategies and implementation plans

## What You Cannot Do
- Edit or apply changes to files
- Run commands that modify the system (including installs or config changes)
- Create, delete, or rename files
- Make git commits or push branches

## Workflow When Plan Mode Is Active
1) Research: Use read‑only tools and exploration only
2) Plan: Draft a clear, step‑by‑step implementation plan
3) Present: Share the plan and request approval to proceed
4) Execute: Only after approval should changes be made

## Environment (for CLIs)
- `EMDASH_PLAN_MODE=1`
- `EMDASH_PLAN_FILE=<absolute path to policy>` (also see this file)

If the provider supports a native plan mode, use it (e.g., for Claude Code: `/plan`).

