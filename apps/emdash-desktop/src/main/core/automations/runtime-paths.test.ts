import { describe, expect, it, vi } from 'vitest';
import { automationRuntimePaths } from './runtime-paths';

vi.mock('@main/db/path', () => ({
  resolveDatabasePath: () => '/tmp/emdash-scratch.db',
}));

describe('automationRuntimePaths', () => {
  it('keeps runtime state isolated with the selected desktop database', () => {
    expect(automationRuntimePaths()).toEqual({
      dbFile: '/tmp/emdash-scratch-automations.db',
      stateDirectory: '/tmp/emdash-scratch-automations',
    });
  });
});
