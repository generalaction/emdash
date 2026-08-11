import { describe, expect, it } from 'vitest';
import { hostFileRefFromNativePath } from './paths';

describe('hostFileRefFromNativePath', () => {
  it('uses the local host by default', () => {
    expect(hostFileRefFromNativePath('/repo')).toMatchObject({
      host: { type: 'local', id: 'local' },
      path: { root: { kind: 'posix' }, segments: ['repo'] },
    });
  });

  it('uses the supplied remote host identity', () => {
    expect(hostFileRefFromNativePath('/repo', 'ssh-1')).toMatchObject({
      host: { type: 'remote', id: 'ssh-1' },
      path: { root: { kind: 'posix' }, segments: ['repo'] },
    });
  });
});
