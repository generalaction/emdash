import { describe, expect, it } from 'vitest';

import { getSshExecuteCommandValidationError } from '../../main/utils/sshCommandValidation';

describe('getSshExecuteCommandValidationError', () => {
  it('allows known-safe renderer SSH commands', () => {
    expect(getSshExecuteCommandValidationError('git status')).toBeNull();
    expect(getSshExecuteCommandValidationError('  ls -la /tmp')).toBeNull();
    expect(getSshExecuteCommandValidationError('pwd')).toBeNull();
    expect(getSshExecuteCommandValidationError('test -d /tmp')).toBeNull();
  });

  it('rejects commands outside the allowlist', () => {
    expect(getSshExecuteCommandValidationError('mkdir -p /tmp/repo')).toBe('Command not allowed');
    expect(getSshExecuteCommandValidationError('rm -rf /tmp/repo')).toBe('Command not allowed');
    expect(getSshExecuteCommandValidationError('')).toBe('Command not allowed');
    expect(getSshExecuteCommandValidationError('pwdx')).toBe('Command not allowed');
  });

  it('rejects shell control characters even for allowed prefixes', () => {
    expect(getSshExecuteCommandValidationError('git status; uname -a')).toBe(
      'Command contains invalid shell control characters'
    );
    expect(getSshExecuteCommandValidationError('git status && uname -a')).toBe(
      'Command contains invalid shell control characters'
    );
    expect(getSshExecuteCommandValidationError('cat /etc/hosts | wc -l')).toBe(
      'Command contains invalid shell control characters'
    );
    expect(getSshExecuteCommandValidationError('echo $HOME')).toBe(
      'Command contains invalid shell control characters'
    );
    expect(getSshExecuteCommandValidationError('pwd\nuname -a')).toBe(
      'Command contains invalid shell control characters'
    );
  });

  it('rejects leading control characters', () => {
    expect(getSshExecuteCommandValidationError('\ngit status')).toBe(
      'Command contains invalid shell control characters'
    );
    expect(getSshExecuteCommandValidationError('\rgit status')).toBe(
      'Command contains invalid shell control characters'
    );
    expect(getSshExecuteCommandValidationError('\r\ngit status')).toBe(
      'Command contains invalid shell control characters'
    );
  });
});
