import path from 'node:path';
import type { ScriptWorkspaceFacts } from '../api/schemas';

/**
 * The host-side script env builder (spec: activation-scripts-via-terminals, env and
 * shellSetup): one builder serves activation and manual runs, so parity holds by
 * construction. The `AGENT_*` vars derive from workspace facts — no desktop-DB
 * lookups, no `process.env` merge, and deliberately no `CI=1` (a documented
 * breaking change). `AGENT_DEFAULT_BRANCH` is omitted when the fact is unknown
 * rather than invented (spec: github-git-settings §12.1, matching the desktop
 * task-env builder). PATH etc. come from the login shell (`$SHELL -lc`)
 * re-sourcing profiles, not from this map.
 */
export function buildScriptEnv(
  workspacePath: string,
  facts: ScriptWorkspaceFacts
): Record<string, string> {
  const taskName = slugify(facts.branch ?? path.basename(workspacePath)) || 'task';
  return {
    AGENT_TASK_ID: facts.workspaceId,
    AGENT_TASK_NAME: taskName,
    AGENT_TASK_PATH: workspacePath,
    AGENT_ROOT_PATH: facts.repositoryPath ?? workspacePath,
    ...(facts.defaultBranch !== undefined ? { AGENT_DEFAULT_BRANCH: facts.defaultBranch } : {}),
    AGENT_PORT: String(basePortFor(workspacePath)),
  };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Same hash as the desktop's historical `getBasePort` (workspace-env.ts) with the
 * same seed (the workspace path), so ports stay stable across the migration.
 */
function basePortFor(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return 50000 + (Math.abs(hash) % 1000) * 10;
}
