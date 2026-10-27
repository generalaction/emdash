import { describe, expect, it } from 'vitest';
import { workspaceRuntimePaths } from './workspace-runtime-paths';

describe('workspaceRuntimePaths', () => {
  it('keeps workspace runtime state isolated with the selected desktop database', () => {
    expect(workspaceRuntimePaths('/tmp/emdash-scratch.db')).toEqual({
      stateDirectory: '/tmp/emdash-scratch-workspaces',
    });
  });
});
