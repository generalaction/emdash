/**
 * Bundled SKILL.md content for the `emdash-coord` skill.
 *
 * Installed at app start into each agent's skill directory
 * (`~/.claude/commands/emdash-coord/`, `~/.codex/skills/emdash-coord/`).
 * Tells the agent when and how to call the coord endpoints on the existing
 * hook server. The `EMDASH_HOOK_PORT` / `EMDASH_HOOK_TOKEN` env vars are
 * already injected into every spawned agent by `hook-config.ts`.
 *
 * Bump SKILL_CONTENT_VERSION whenever the content meaningfully changes —
 * the installer compares against the on-disk version marker and refreshes.
 */
export const SKILL_CONTENT_VERSION = '1';

export const SKILL_CONTENT = `---
name: emdash-coord
description: Check what other emdash tasks are working on before you start work or edit files, to avoid redundant or conflicting changes across sibling worktrees.
allowed-tools: Bash
---

# Sibling-task awareness

You are running inside one of several emdash worktrees of the same project. Other tasks may be working in parallel. Before starting a new piece of work, or before editing files you haven't touched yet, check whether a sibling task is already active in the same area.

## List active sibling tasks

\`\`\`bash
curl -sf \\
  -H "X-Emdash-Token: $EMDASH_HOOK_TOKEN" \\
  "http://127.0.0.1:$EMDASH_HOOK_PORT/coord/siblings"
\`\`\`

Returns JSON with each active sibling task's branch, name, status, last activity timestamp, and the files it has touched.

## Check overlap for specific paths

\`\`\`bash
curl -sf \\
  -H "X-Emdash-Token: $EMDASH_HOOK_TOKEN" \\
  "http://127.0.0.1:$EMDASH_HOOK_PORT/coord/overlap?paths=src/foo.ts,src/bar.ts"
\`\`\`

Paths are repo-relative and comma-separated. Returns which sibling tasks have touched each path recently.

## What to do when you find overlap

- If a sibling is already working on the same feature: stop and report it, rather than duplicating effort.
- If a sibling is touching files you need to edit: decide whether to wait, coordinate, or work on a different slice.
- If the overlap is minor (shared utility, type file): proceed with awareness so you don't blindly conflict.

This is passive awareness only — there are no locks. Use judgement.
`;
