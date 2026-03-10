import { describe, expect, it } from 'vitest';
import { shouldRefreshFileChanges } from '../../renderer/hooks/useFileChanges';

describe('shouldRefreshFileChanges', () => {
  it('refreshes when the task is active and the document is visible', () => {
    expect(shouldRefreshFileChanges('/tmp/task', true, true)).toBe(true);
  });

  it('refreshes when the task is active and the document is visible (focus is no longer required)', () => {
    expect(shouldRefreshFileChanges('/tmp/task', true, true)).toBe(true);
  });

  it('does not refresh when the task path is missing', () => {
    expect(shouldRefreshFileChanges(undefined, true, true)).toBe(false);
  });

  it('does not refresh when the task is inactive', () => {
    expect(shouldRefreshFileChanges('/tmp/task', false, true)).toBe(false);
  });

  it('does not refresh when the document is hidden', () => {
    expect(shouldRefreshFileChanges('/tmp/task', true, false)).toBe(false);
  });
});
