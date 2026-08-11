import { describe, expect, it } from 'vitest';
import { hostRef } from '../../../primitives/host/api';
import {
  isRuntimeResolveError,
  runtimeHostNotConfigured,
  runtimeHostUnavailable,
  runtimeResolveErrorAsError,
} from './errors';

describe('RuntimeResolveError helpers', () => {
  it('constructs and recognizes both resolver error variants', () => {
    const remote = hostRef('remote', 'ssh-1');
    const unavailable = runtimeHostUnavailable(remote, 'Remote runtime unavailable');
    const notConfigured = runtimeHostNotConfigured(remote, 'Remote runtime not configured');

    expect(isRuntimeResolveError(unavailable)).toBe(true);
    expect(isRuntimeResolveError(notConfigured)).toBe(true);
  });

  it('preserves the discriminant when an exception boundary is unavoidable', () => {
    const payload = runtimeHostUnavailable(
      hostRef('remote', 'ssh-1'),
      'Remote runtime unavailable'
    );

    expect(runtimeResolveErrorAsError(payload)).toMatchObject(payload);
  });
});
