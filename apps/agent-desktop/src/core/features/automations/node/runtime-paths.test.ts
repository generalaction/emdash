import { describe, expect, it } from 'vitest';
import { automationRuntimePaths } from './runtime-paths';

describe('automationRuntimePaths', () => {
  it('keeps runtime state isolated with the selected desktop database', () => {
    expect(automationRuntimePaths('/tmp/agent-scratch.db')).toEqual({
      dbFile: '/tmp/agent-scratch-automations.db',
    });
  });
});
