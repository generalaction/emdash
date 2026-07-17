import { describe, expect, it, vi } from 'vitest';
import { workspaceRuntimePaths } from './workspace-runtime-paths';

vi.mock('@main/db/path', () => ({
  resolveDatabasePath: () => '/tmp/emdash-scratch.db',
}));

describe('workspaceRuntimePaths', () => {
  it('keeps workspace runtime state isolated with the selected desktop database', () => {
    expect(workspaceRuntimePaths()).toEqual({
      stateDirectory: '/tmp/emdash-scratch-workspaces',
      worktreePoolPath: '/tmp/emdash-scratch-workspaces/worktrees',
    });
  });
});
