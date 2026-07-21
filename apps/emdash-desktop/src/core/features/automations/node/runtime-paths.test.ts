import { describe, expect, it } from 'vitest';
import { automationRuntimePaths } from './runtime-paths';

describe('automationRuntimePaths', () => {
  it('keeps runtime state isolated with the selected desktop database', () => {
    expect(automationRuntimePaths('/tmp/emdash-scratch.db')).toEqual({
      dbFile: '/tmp/emdash-scratch-automations.db',
      stateDirectory: '/tmp/emdash-scratch-automations',
    });
  });
});
