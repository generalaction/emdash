import { describe, expect, it } from 'vitest';
import { workspaceWorkerBuildInputs, workspaceWorkerPath } from './worker-manifest';

const runtimeIds = [
  'acp',
  'agent-config',
  'automations',
  'file-search',
  'files',
  'git',
  'terminals',
  'tui-agents',
  'workspace',
] as const;

describe('workspace worker manifest', () => {
  it('packages every core runtime and the shared filesystem watcher', () => {
    const entries = workspaceWorkerBuildInputs();

    expect(Object.keys(entries).sort()).toEqual(
      [...runtimeIds.map((id) => `${id}-runtime`), 'fs-watch-runtime'].sort()
    );
    for (const id of runtimeIds) {
      expect(workspaceWorkerPath(id).endsWith(`${id}-runtime.mjs`)).toBe(true);
    }
  });
});
