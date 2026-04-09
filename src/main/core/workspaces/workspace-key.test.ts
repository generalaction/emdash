import { describe, expect, it } from 'vitest';
import { workspaceKey } from './workspace-key';

describe('workspaceKey', () => {
  it('returns root key when task branch is missing', () => {
    expect(workspaceKey(undefined)).toBe('root:');
  });

  it('prefixes branch keys to avoid collisions with root sentinel', () => {
    expect(workspaceKey('feature/my-task')).toBe('branch:feature/my-task');
  });
});
