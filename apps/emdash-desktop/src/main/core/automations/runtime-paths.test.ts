import { describe, expect, it, vi } from 'vitest';
import * as databasePath from '@main/db/path';
import { automationRuntimePaths } from './runtime-paths';

vi.spyOn(databasePath, 'resolveDatabasePath').mockReturnValue('/tmp/emdash-scratch.db');

describe('automationRuntimePaths', () => {
  it('keeps runtime state isolated with the selected desktop database', () => {
    expect(automationRuntimePaths()).toEqual({
      dbFile: '/tmp/emdash-scratch-automations.db',
      stateDirectory: '/tmp/emdash-scratch-automations',
    });
  });
});
