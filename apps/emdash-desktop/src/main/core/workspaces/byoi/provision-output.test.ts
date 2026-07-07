import { describe, expect, it } from 'vitest';
import { parseProvisionOutput } from './provision-output';

describe('parseProvisionOutput', () => {
  it('accepts explicit BYOI SSH agent forwarding intent', () => {
    const result = parseProvisionOutput(
      JSON.stringify({
        id: 'workspace-1',
        host: 'remote.example.com',
        forwardAgent: true,
      })
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.forwardAgent).toBe(true);
    }
  });

  it('rejects non-boolean forwardAgent values', () => {
    const result = parseProvisionOutput(
      JSON.stringify({
        id: 'workspace-1',
        host: 'remote.example.com',
        forwardAgent: 'true',
      })
    );

    expect(result.success).toBe(false);
  });
});
