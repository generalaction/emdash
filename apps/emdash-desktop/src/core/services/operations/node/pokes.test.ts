import { formatHostRef, LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { describe, expect, it, vi } from 'vitest';
import { onOperationSettled, publishOperationSettled } from './pokes';

describe('operation settlement events', () => {
  it('delivers scoped host and repository identity until unsubscribed', () => {
    const listener = vi.fn();
    const unsubscribe = onOperationSettled(listener);
    const event = {
      hostRef: formatHostRef(LOCAL_HOST_REF),
      repoPath: '/repo',
      status: 'succeeded' as const,
    };

    publishOperationSettled(event);
    unsubscribe();
    publishOperationSettled(event);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(event);
  });
});
