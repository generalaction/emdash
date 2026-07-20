import { describe, expect, it, vi } from 'vitest';
import * as databasePath from '@main/db/path';
import { workspaceRuntimePaths } from './workspace-runtime-paths';

vi.spyOn(databasePath, 'resolveDatabasePath').mockReturnValue('/tmp/emdash-scratch.db');

describe('workspaceRuntimePaths', () => {
  it('keeps workspace runtime state isolated with the selected desktop database', () => {
    expect(workspaceRuntimePaths()).toEqual({
      stateDirectory: '/tmp/emdash-scratch-workspaces',
    });
  });
});
