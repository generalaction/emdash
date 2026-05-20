import { describe, expect, it } from 'vitest';
import { suggestedAuthTypeForSshConfigHost } from './ssh-connection-form-model';

describe('suggestedAuthTypeForSshConfigHost', () => {
  it('defaults imported SSH config aliases to agent auth even when ssh -G reports identity files', () => {
    expect(
      suggestedAuthTypeForSshConfigHost({
        host: 'corp-dev',
        identityFile: '~/.ssh/id_rsa',
      })
    ).toBe('agent');
  });
});
